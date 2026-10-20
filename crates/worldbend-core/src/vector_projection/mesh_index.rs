//! Bounded broad phase only. Exact source-coordinate boxes cannot discard a
//! face containing the complete control hull, or an edge intersecting a chord.
//! Robust face/edge predicates remain the authority; output order is unchanged.
use super::*;

type Box2 = [f64; 4];
struct Node {
    bounds: Box2,
    kind: Kind,
}
enum Kind {
    Leaf(Vec<usize>),
    Branch(usize, usize),
}
#[derive(Default)]
pub(super) struct MeshIndex {
    nodes: Vec<Node>,
}
fn bounds(points: &[Point]) -> Box2 {
    [
        points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
        points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
        points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
        points.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
    ]
}
fn overlaps(a: Box2, b: Box2) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}
impl MeshIndex {
    #[cfg(test)]
    pub(super) fn all_candidates(count: usize) -> Self {
        Self {
            nodes: vec![Node {
                bounds: [
                    f64::NEG_INFINITY,
                    f64::NEG_INFINITY,
                    f64::INFINITY,
                    f64::INFINITY,
                ],
                kind: Kind::Leaf((0..count).collect()),
            }],
        }
    }
    pub(super) fn new(
        items: impl IntoIterator<Item = Vec<Point>>,
        work: Option<&ProjectionWork>,
    ) -> TransformResult<Self> {
        let boxes: Vec<_> = items.into_iter().map(|points| bounds(&points)).collect();
        let mut index = Self::default();
        if !boxes.is_empty() {
            index.build(&boxes, (0..boxes.len()).collect(), work)?;
        }
        Ok(index)
    }
    fn build(
        &mut self,
        boxes: &[Box2],
        mut indices: Vec<usize>,
        work: Option<&ProjectionWork>,
    ) -> TransformResult<usize> {
        if let Some(work) = work {
            work.charge(WorkKind::Face, indices.len())?;
        }
        let merged = indices.iter().fold(
            [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ],
            |b, &i| {
                [
                    b[0].min(boxes[i][0]),
                    b[1].min(boxes[i][1]),
                    b[2].max(boxes[i][2]),
                    b[3].max(boxes[i][3]),
                ]
            },
        );
        let position = self.nodes.len();
        self.nodes.push(Node {
            bounds: merged,
            kind: Kind::Leaf(Vec::new()),
        });
        self.nodes[position].kind = if indices.len() <= 8 {
            Kind::Leaf(indices)
        } else {
            let axis = usize::from(merged[3] - merged[1] > merged[2] - merged[0]);
            // Center ordering determines performance, never geometric admission.
            indices.sort_unstable_by(|&a, &b| {
                (boxes[a][axis] + boxes[a][axis + 2])
                    .total_cmp(&(boxes[b][axis] + boxes[b][axis + 2]))
                    .then(a.cmp(&b))
            });
            let right = indices.split_off(indices.len() / 2);
            Kind::Branch(
                self.build(boxes, indices, work)?,
                self.build(boxes, right, work)?,
            )
        };
        Ok(position)
    }
    pub(super) fn candidates(
        &self,
        points: &[Point],
        visit: &impl Fn() -> TransformResult<()>,
    ) -> TransformResult<Vec<usize>> {
        let query = bounds(points);
        let mut result = Vec::new();
        if !self.nodes.is_empty() {
            self.query(0, query, visit, &mut result)?;
        }
        // First exact containing face, and declared edge order, remain stable.
        result.sort_unstable();
        Ok(result)
    }
    fn query(
        &self,
        index: usize,
        query: Box2,
        visit: &impl Fn() -> TransformResult<()>,
        result: &mut Vec<usize>,
    ) -> TransformResult<()> {
        visit()?;
        let node = &self.nodes[index];
        if overlaps(node.bounds, query) {
            match &node.kind {
                Kind::Leaf(indices) => result.extend(indices),
                Kind::Branch(a, b) => {
                    self.query(*a, query, visit, result)?;
                    self.query(*b, query, visit, result)?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn broad_phase_preserves_exact_inclusive_boxes_and_order_for_seams_slivers_and_exterior_handles()
     {
        let mut items = vec![
            vec![Point::new(0., 0.), Point::new(1., 1.)],
            vec![Point::new(0.5, 0.), Point::new(0.5, 1.)],
            vec![
                Point::new(0.5, 0.5),
                Point::new(0.5_f64.next_up(), 0.5_f64.next_up()),
            ],
        ];
        for i in 0..100 {
            let x = f64::from(i) / 100.;
            items.push(vec![Point::new(x, 0.), Point::new(x, 1.)]);
        }
        let index = MeshIndex::new(items.clone(), None).unwrap();
        for query in [
            vec![Point::new(0.5, 0.5)],
            vec![Point::new(0.5_f64.next_up(), 0.5)],
            vec![Point::new(-100., 0.5), Point::new(100., 0.5)],
            vec![Point::new(0., 0.), Point::new(1., 1.)],
        ] {
            let found = index.candidates(&query, &|| Ok(())).unwrap();
            assert!(found.windows(2).all(|pair| pair[0] < pair[1]));
            for (i, item) in items.iter().enumerate() {
                if overlaps(bounds(item), bounds(&query)) {
                    assert!(found.contains(&i));
                }
            }
        }
    }
}
