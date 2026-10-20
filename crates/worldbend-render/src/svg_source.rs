//! Self-contained outlined SVG media decoding, separate from canonical geometry.
//! No font lookup, file/URL resolution, script, animation or nested image SVG.
//! Preflight bounds expansion and embedded media before usvg can allocate them.
use super::{RenderLimits, decode_image_with_limits, validate_source_dimensions};
use image::DynamicImage;
use resvg::{tiny_skia, usvg};
use roxmltree::{Document, NodeId, ParsingOptions};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};
use worldbend_core::{ErrorCode, TransformError, TransformResult};

const MAX_SVG_BYTES: usize = 8 * 1024 * 1024;
const MAX_NODES: usize = 20_000;
const MAX_SEGMENTS: usize = 1_000_000;
const MAX_DEPTH: usize = 64;

pub(super) fn looks_like_xml(bytes: &[u8]) -> bool {
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    bytes.iter().copied().find(|v| !v.is_ascii_whitespace()) == Some(b'<')
}
fn unsupported(message: &str) -> TransformError {
    TransformError::new(ErrorCode::UnsupportedMedia, message)
}
fn limit(message: &str) -> TransformError {
    TransformError::new(ErrorCode::OutputLimit, message)
}
fn references(value: &str) -> TransformResult<Vec<String>> {
    let mut refs = Vec::new();
    let lower = value.to_ascii_lowercase();
    let mut tail = lower.as_str();
    while let Some(start) = tail.find("url(") {
        tail = &tail[start + 4..];
        let end = tail
            .find(')')
            .ok_or_else(|| unsupported("Invalid SVG paint reference"))?;
        let reference = tail[..end].trim().trim_matches(['\'', '"']);
        let id = reference
            .strip_prefix('#')
            .filter(|v| !v.is_empty())
            .ok_or_else(|| unsupported("SVG paint resources must be internal references"))?;
        // Keep case-sensitive IDs from the original attribute, not the scan copy.
        let offset = value.len() - tail.len();
        let original = value[offset..offset + end].trim().trim_matches(['\'', '"']);
        refs.push(original[1..].to_owned());
        let _ = id;
        tail = &tail[end + 1..];
    }
    Ok(refs)
}
fn preflight(xml: &str) -> TransformResult<Document<'_>> {
    let doc = Document::parse_with_options(
        xml,
        ParsingOptions {
            allow_dtd: false,
            nodes_limit: MAX_NODES as u32,
            ..Default::default()
        },
    )
    .map_err(|error| match error {
        roxmltree::Error::NodesLimitReached => limit("SVG exceeds 20000 XML nodes"),
        _ => unsupported("Use a valid SVG without a DTD"),
    })?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg"
        || root
            .tag_name()
            .namespace()
            .is_some_and(|v| v != "http://www.w3.org/2000/svg")
    {
        return Err(unsupported("Source XML must be SVG"));
    }
    let mut ids = HashMap::new();
    let mut graph: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    let mut named_refs = Vec::new();
    let mut segments = 0usize;
    let mut path_costs = HashMap::new();
    for node in doc.descendants().filter(|n| n.is_element()) {
        if node.ancestors().count() > MAX_DEPTH {
            return Err(limit("SVG exceeds 64 levels"));
        }
        let tag = node.tag_name().name();
        if node
            .tag_name()
            .namespace()
            .is_some_and(|v| v != "http://www.w3.org/2000/svg")
            || !matches!(
                tag,
                "svg"
                    | "defs"
                    | "g"
                    | "path"
                    | "rect"
                    | "circle"
                    | "ellipse"
                    | "polygon"
                    | "polyline"
                    | "line"
                    | "linearGradient"
                    | "radialGradient"
                    | "stop"
                    | "pattern"
                    | "clipPath"
                    | "mask"
                    | "filter"
                    | "use"
                    | "feBlend"
                    | "feColorMatrix"
                    | "feComponentTransfer"
                    | "feFuncR"
                    | "feFuncG"
                    | "feFuncB"
                    | "feFuncA"
                    | "feComposite"
                    | "feConvolveMatrix"
                    | "feDiffuseLighting"
                    | "feDistantLight"
                    | "fePointLight"
                    | "feSpotLight"
                    | "feDisplacementMap"
                    | "feDropShadow"
                    | "feFlood"
                    | "feGaussianBlur"
                    | "feImage"
                    | "feMerge"
                    | "feMergeNode"
                    | "feMorphology"
                    | "feOffset"
                    | "feSpecularLighting"
                    | "feTile"
                    | "feTurbulence"
                    | "image"
                    | "title"
                    | "desc"
            )
        {
            return Err(unsupported(
                "SVG source needs outlined text and supported static SVG elements",
            ));
        }
        if let Some(id) = node.attribute("id")
            && ids.insert(id, node.id()).is_some()
        {
            return Err(unsupported("SVG IDs must be unique"));
        }
        graph.insert(
            node.id(),
            node.children()
                .filter(|n| n.is_element())
                .map(|n| n.id())
                .collect(),
        );
        for attr in node.attributes() {
            if attr.name().starts_with("on")
                || attr.name() == "base"
                || (attr.name() == "style"
                    && (attr.value().contains('\\') || attr.value().contains('@')))
            {
                return Err(unsupported(
                    "SVG scripts, external CSS and base URLs are unsupported",
                ));
            }
            for reference in references(attr.value())? {
                named_refs.push((node.id(), reference));
            }
            if attr.name() == "href" {
                if let Some(id) = attr.value().strip_prefix('#') {
                    named_refs.push((node.id(), id.to_owned()));
                } else if !matches!(tag, "image" | "feImage")
                    || ![
                        "data:image/png;base64,",
                        "data:image/jpeg;base64,",
                        "data:image/jpg;base64,",
                        "data:image/webp;base64,",
                    ]
                    .iter()
                    .any(|prefix| attr.value().starts_with(prefix))
                {
                    return Err(unsupported(
                        "SVG images must be embedded PNG, JPEG or WebP; external resources are unavailable",
                    ));
                }
            }
        }
        if matches!(tag, "image" | "feImage") && !node.attributes().any(|a| a.name() == "href") {
            return Err(unsupported("SVG images need an explicit embedded resource"));
        }
        if let Some(path) = node.attribute("d") {
            let start = segments;
            for segment in svgtypes::PathParser::from(path) {
                let segment = segment.map_err(|_| unsupported("Invalid SVG path data"))?;
                use svgtypes::PathSegment::*;
                let values: Vec<f64> = match segment {
                    MoveTo { x, y, .. } | LineTo { x, y, .. } | SmoothQuadratic { x, y, .. } => {
                        vec![x, y]
                    }
                    HorizontalLineTo { x, .. } => vec![x],
                    VerticalLineTo { y, .. } => vec![y],
                    CurveTo {
                        x1,
                        y1,
                        x2,
                        y2,
                        x,
                        y,
                        ..
                    } => vec![x1, y1, x2, y2, x, y],
                    SmoothCurveTo { x2, y2, x, y, .. } => vec![x2, y2, x, y],
                    Quadratic { x1, y1, x, y, .. } => vec![x1, y1, x, y],
                    EllipticalArc {
                        rx,
                        ry,
                        x_axis_rotation,
                        x,
                        y,
                        ..
                    } => vec![rx, ry, x_axis_rotation, x, y],
                    ClosePath { .. } => vec![],
                };
                if values.iter().any(|v| !(*v as f32).is_finite()) {
                    return Err(unsupported(
                        "SVG path coordinates exceed renderer precision",
                    ));
                }
                segments += 1;
                if segments > MAX_SEGMENTS {
                    return Err(limit("SVG exceeds one million source path segments"));
                }
            }
            path_costs.insert(node.id(), segments - start);
        }
        if tag == "feTurbulence"
            && node
                .attribute("numOctaves")
                .is_some_and(|v| v.parse::<u32>().ok().is_none_or(|n| n > 8))
        {
            return Err(limit("SVG turbulence exceeds eight octaves"));
        }
        if tag == "feConvolveMatrix" {
            let order = node
                .attribute("order")
                .unwrap_or("3")
                .split_whitespace()
                .map(str::parse::<u32>)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| unsupported("Invalid SVG convolution order"))?;
            let size = match order.as_slice() {
                [x] => u64::from(*x) * u64::from(*x),
                [x, y] => u64::from(*x) * u64::from(*y),
                _ => 0,
            };
            if size == 0 || size > 81 {
                return Err(limit("SVG convolution exceeds 81 samples"));
            }
        }
    }
    for (node, name) in named_refs {
        let id = *ids
            .get(name.as_str())
            .ok_or_else(|| unsupported("SVG references an absent resource"))?;
        graph.get_mut(&node).unwrap().push(id);
    }
    fn count(
        id: NodeId,
        graph: &HashMap<NodeId, Vec<NodeId>>,
        costs: &HashMap<NodeId, usize>,
        active: &mut HashSet<NodeId>,
        memo: &mut HashMap<NodeId, (usize, usize)>,
        depth: usize,
    ) -> TransformResult<(usize, usize)> {
        if depth > MAX_DEPTH {
            return Err(limit("SVG resource expansion exceeds 64 levels"));
        }
        if !active.insert(id) {
            return Err(unsupported("Recursive SVG resources are unsupported"));
        }
        if let Some(value) = memo.get(&id) {
            active.remove(&id);
            return Ok(*value);
        }
        let mut total = (1usize, *costs.get(&id).unwrap_or(&0));
        for next in &graph[&id] {
            let (nodes, segments) = count(*next, graph, costs, active, memo, depth + 1)?;
            total.0 = total.0.saturating_add(nodes);
            total.1 = total.1.saturating_add(segments);
            if total.0 > MAX_NODES || total.1 > MAX_SEGMENTS {
                return Err(limit(
                    "SVG expanded resources exceed 20000 nodes / one million segments",
                ));
            }
        }
        active.remove(&id);
        memo.insert(id, total);
        Ok(total)
    }
    count(
        root.id(),
        &graph,
        &path_costs,
        &mut HashSet::new(),
        &mut HashMap::new(),
        0,
    )?;
    Ok(doc)
}

pub(super) fn decode(bytes: &[u8], limits: RenderLimits) -> TransformResult<DynamicImage> {
    if bytes.len() > MAX_SVG_BYTES {
        return Err(limit("Outlined SVG exceeds 8 MiB"));
    }
    let xml = std::str::from_utf8(bytes).map_err(|_| unsupported("SVG must be UTF-8"))?;
    let doc = preflight(xml)?;
    let root = doc.root_element();
    let axis = |name| -> TransformResult<f32> {
        let text = root
            .attribute(name)
            .ok_or_else(|| unsupported("Outlined SVG needs explicit width and height"))?
            .trim();
        let value = text
            .strip_suffix("px")
            .unwrap_or(text)
            .parse::<f32>()
            .map_err(|_| unsupported("Outlined SVG axes must be numeric pixels"))?;
        if !value.is_finite() || value <= 0.0 {
            return Err(unsupported("SVG axes must be finite and positive"));
        }
        Ok(value)
    };
    let logical_width = axis("width")?;
    let logical_height = axis("height")?;
    let width = logical_width.ceil() as u32;
    let height = logical_height.ceil() as u32;
    validate_source_dimensions(width, height, limits)?;
    let failure = Mutex::new(None);
    let embedded_pixels = Mutex::new(0u64);
    let options = usvg::Options {
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_string: Box::new(|_, _| None),
            resolve_data: Box::new(|mime, data, _| {
                let result = (|| {
                    if !matches!(
                        mime,
                        "image/png" | "image/jpeg" | "image/jpg" | "image/webp"
                    ) {
                        return Err(unsupported("Unsupported embedded SVG image"));
                    }
                    let mut total = embedded_pixels.lock().unwrap();
                    let remaining = limits.max_pixels.saturating_sub(*total);
                    if remaining == 0 {
                        return Err(limit(
                            "SVG embedded images exceed the cumulative pixel budget",
                        ));
                    }
                    let reader = image::ImageReader::new(std::io::Cursor::new(data.as_slice()))
                        .with_guessed_format()
                        .map_err(|_| unsupported("Invalid embedded SVG image"))?;
                    if !matches!(
                        reader.format(),
                        Some(
                            image::ImageFormat::Png
                                | image::ImageFormat::Jpeg
                                | image::ImageFormat::WebP
                        )
                    ) {
                        return Err(unsupported(
                            "Embedded SVG media must actually be PNG, JPEG or WebP",
                        ));
                    }
                    let decoded = decode_image_with_limits(
                        &data,
                        RenderLimits {
                            max_pixels: remaining,
                            ..limits
                        },
                    )?
                    .to_rgba8();
                    *total += u64::from(decoded.width()) * u64::from(decoded.height());
                    let mut png = Vec::new();
                    super::file_io::write_png(&decoded, &mut png)?;
                    Ok(usvg::ImageKind::PNG(Arc::new(png)))
                })();
                match result {
                    Ok(image) => Some(image),
                    Err(error) => {
                        *failure.lock().unwrap() = Some(error);
                        None
                    }
                }
            }),
        },
        ..Default::default()
    };
    let tree =
        usvg::Tree::from_str(xml, &options).map_err(|_| unsupported("SVG cannot be decoded"))?;
    drop(options);
    if let Some(error) = failure.into_inner().unwrap() {
        return Err(error);
    }
    // Conservatively budget every live isolated layer and filter scratch plane
    // before rendering. resvg itself clips temporary bounds to 5x each axis.
    let pixels = u64::from(width) * u64::from(height);
    let mut surfaces = 0u64;
    let mut nodes = 0usize;
    let mut segments = 0usize;
    fn walk(
        group: &usvg::Group,
        depth: usize,
        nodes: &mut usize,
        segments: &mut usize,
        surfaces: &mut u64,
    ) -> TransformResult<()> {
        if depth > MAX_DEPTH {
            return Err(limit("Decoded SVG exceeds 64 levels"));
        }
        if group.should_isolate() {
            let primitives = group
                .filters()
                .iter()
                .map(|f| f.primitives().len() as u64)
                .sum::<u64>();
            *surfaces = surfaces.saturating_add(1 + 4 * primitives);
        }
        for node in group.children() {
            *nodes += 1;
            if *nodes > MAX_NODES {
                return Err(limit("Decoded SVG exceeds 20000 nodes"));
            }
            match node {
                usvg::Node::Group(g) => walk(g, depth + 1, nodes, segments, surfaces)?,
                usvg::Node::Path(p) => {
                    *segments = segments.saturating_add(p.data().segments().count());
                    if *segments > MAX_SEGMENTS {
                        return Err(limit("Decoded SVG exceeds one million path segments"));
                    }
                }
                _ => {}
            }
            let mut error = None;
            node.subroots(|g| {
                if error.is_none() {
                    error = walk(g, depth + 1, nodes, segments, surfaces).err();
                }
            });
            if let Some(error) = error {
                return Err(error);
            }
        }
        Ok(())
    }
    walk(tree.root(), 0, &mut nodes, &mut segments, &mut surfaces)?;
    let working_bytes = pixels
        .saturating_mul(8)
        .saturating_add(pixels.saturating_mul(100).saturating_mul(surfaces))
        .saturating_add(embedded_pixels.into_inner().unwrap().saturating_mul(16));
    let maximum = limits.max_pixels.saturating_mul(16).min(1024 * 1024 * 1024);
    if working_bytes > maximum {
        return Err(limit("SVG layers exceed the bounded working allocation"));
    }
    let mut pixmap = tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| limit("SVG pixel allocation unavailable"))?;
    let transform = tiny_skia::Transform::from_scale(
        width as f32 / tree.size().width(),
        height as f32 / tree.size().height(),
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    // tiny-skia returns associated color. Existing Worldbend samplers consume
    // straight RGBA and perform their own premultiplication during filtering.
    let rgba = pixmap
        .take()
        .chunks_exact(4)
        .flat_map(|p| {
            let alpha = u32::from(p[3]);
            let channel = |n| {
                (u32::from(n) * 255 + alpha / 2)
                    .checked_div(alpha)
                    .unwrap_or(0)
                    .min(255) as u8
            };
            [channel(p[0]), channel(p[1]), channel(p[2]), p[3]]
        })
        .collect();
    Ok(DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(width, height, rgba)
            .ok_or_else(|| limit("SVG raster allocation unavailable"))?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    use image::GenericImageView;
    fn svg(body: &str) -> String {
        format!("<svg xmlns='http://www.w3.org/2000/svg' width='32' height='24'>{body}</svg>")
    }
    fn raster(body: &str) -> image::RgbaImage {
        super::super::decode_image_with_limits(svg(body).as_bytes(), RenderLimits::default())
            .unwrap()
            .to_rgba8()
    }
    #[test]
    fn static_gradients_clips_internal_case_sensitive_reuse_and_straight_alpha_survive() {
        let image = raster(
            "<defs><linearGradient id='Paint'><stop stop-color='#ff0000'/><stop offset='1' stop-color='#0000ff'/></linearGradient><clipPath id='Crop'><rect width='16' height='24'/></clipPath><path id='Shape' d='M0 0H32V24H0Z'/></defs><use href='#Shape' fill='url(#Paint)' clip-path='url(#Crop)' opacity='.5'/>",
        );
        assert_eq!(image.dimensions(), (32, 24));
        assert_eq!(image.get_pixel(20, 12).0, [0, 0, 0, 0]);
        let p = image.get_pixel(4, 12).0;
        assert!((126..=129).contains(&p[3]));
        assert!(p[0] > 210 && p[2] < 45 && p[1] == 0);
    }
    #[test]
    fn embedded_media_is_decoded_under_cumulative_limits_and_is_not_silently_omitted() {
        let pixel = image::RgbaImage::from_pixel(1, 1, image::Rgba([200, 80, 40, 128]));
        let mut encoded = Vec::new();
        super::super::file_io::write_png(&pixel, &mut encoded).unwrap();
        let url = format!("data:image/png;base64,{}", STANDARD.encode(encoded));
        let tag = format!("<image width='32' height='24' href='{url}'/>");
        let image = raster(&tag);
        let p = image.get_pixel(16, 12).0;
        assert!(p[0].abs_diff(200) <= 1 && p[1].abs_diff(80) <= 1 && p[2].abs_diff(40) <= 1);
        assert_eq!(p[3], 128);
        let tiny =
            svg(&format!("{tag}{tag}")).replace("width='32' height='24'", "width='1' height='1'");
        let error = decode(
            tiny.as_bytes(),
            RenderLimits {
                max_pixels: 1,
                ..RenderLimits::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
        let bad = svg("<image width='32' height='24' href='data:image/png;base64,AAAA'/>");
        assert_eq!(
            decode(bad.as_bytes(), RenderLimits::default())
                .unwrap_err()
                .code,
            ErrorCode::UnsupportedMedia
        );
        let forged = svg(&format!(
            "<image width='32' height='24' href='data:image/png;base64,{}'/>",
            STANDARD.encode(svg("<rect width='32' height='24'/>"))
        ));
        assert_eq!(
            decode(forged.as_bytes(), RenderLimits::default())
                .unwrap_err()
                .code,
            ErrorCode::UnsupportedMedia
        );
    }
    #[test]
    fn static_shadow_and_fractional_viewport_have_visible_coverage() {
        let image = raster(
            "<defs><filter id='Shadow' x='-1' y='-1' width='3' height='3'><feGaussianBlur stdDeviation='1'/></filter></defs><rect x='8' y='6' width='8' height='8' fill='red' filter='url(#Shadow)'/>",
        );
        assert!(image.get_pixel(12, 10)[3] > 240);
        assert!(image.get_pixel(7, 10)[3] > 0);
        let fractional = svg("<rect width='32' height='24' fill='red'/>")
            .replace("width='32' height='24'", "width='31.25' height='23.5'");
        assert_eq!(
            decode(fractional.as_bytes(), RenderLimits::default())
                .unwrap()
                .dimensions(),
            (32, 24)
        );
    }
    #[test]
    fn external_or_unrepresented_content_and_recursive_expansion_reject_before_rendering() {
        for body in [
            "<image href='/private/source.png'/>",
            "<image href='https://example.com/a.png'/>",
            "<rect fill='url(https://example.com/a)'/>",
            "<text>Keep me</text>",
            "<foreignObject/>",
            "<animate/>",
            "<style>@import 'local.css';</style>",
            "<g onclick='alert(1)'/>",
            "<use href='#absent'/>",
            "<g id='loop'><use href='#loop'/></g>",
            "<path d='M0?bad'/>",
            "<image href='data:image/svg+xml;base64,AAAA'/>",
        ] {
            assert_eq!(
                decode(svg(body).as_bytes(), RenderLimits::default())
                    .unwrap_err()
                    .code,
                ErrorCode::UnsupportedMedia,
                "{body}"
            );
        }
        let dtd = "<!DOCTYPE svg [<!ENTITY x 'bad'>]><svg width='1' height='1'>&x;</svg>";
        assert_eq!(
            decode(dtd.as_bytes(), RenderLimits::default())
                .unwrap_err()
                .code,
            ErrorCode::UnsupportedMedia
        );
        let mut defs = "<g id='a0'><rect width='1' height='1'/></g>".to_owned();
        for i in 1..16 {
            defs.push_str(&format!(
                "<g id='a{i}'><use href='#a{}'/><use href='#a{}'/></g>",
                i - 1,
                i - 1
            ));
        }
        assert_eq!(
            decode(
                svg(&format!("<defs>{defs}</defs><use href='#a15'/>")).as_bytes(),
                RenderLimits::default()
            )
            .unwrap_err()
            .code,
            ErrorCode::OutputLimit
        );
    }
    #[test]
    fn filter_scratch_and_reused_path_work_are_bounded_before_allocation() {
        let filters = "<feFlood/>".repeat(32);
        let large=svg(&format!("<defs><filter id='scratch'>{filters}</filter></defs><rect width='512' height='512' filter='url(#scratch)'/>")).replace("width='32' height='24'","width='512' height='512'");
        assert_eq!(
            decode(large.as_bytes(), RenderLimits::default())
                .unwrap_err()
                .code,
            ErrorCode::OutputLimit
        );
        let path = format!("M0 0{}", "L1 1".repeat(10000));
        let work = svg(&format!(
            "<defs><path id='shape' d='{path}'/></defs>{}",
            "<use href='#shape'/>".repeat(101)
        ));
        assert_eq!(
            decode(work.as_bytes(), RenderLimits::default())
                .unwrap_err()
                .code,
            ErrorCode::OutputLimit
        );
        assert_eq!(
            decode(
                svg("<path d='M1e100 1L2 2'/>").as_bytes(),
                RenderLimits::default()
            )
            .unwrap_err()
            .code,
            ErrorCode::UnsupportedMedia
        );
        assert_eq!(
            decode(
                svg("<image width='1' height='1'/>").as_bytes(),
                RenderLimits::default()
            )
            .unwrap_err()
            .code,
            ErrorCode::UnsupportedMedia
        );
    }
}
