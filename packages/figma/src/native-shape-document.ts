import { documentShapeForSource } from "./native-shape";
import type { DocumentShape } from "./native-shape";

/** Reading a guide must not mutate the document: even temporary nodes erase
 * Figma's redo history. fillGeometry supplies Figma's resolved corner curves,
 * whereas vectorPaths omits the vertex corner treatment. Keep the ordinary
 * path getter for sharp networks so existing full-precision paths stay intact. */
export async function captureDocumentShapeForSource(
  source: SceneNode,
): Promise<DocumentShape | undefined> {
  if (source.type !== "VECTOR") return undefined;
  if (!source.vectorNetwork.vertices.some(vertex => (vertex.cornerRadius ?? 0) > 0)) {
    return documentShapeForSource(source);
  }
  return documentShapeForSource({ type: "VECTOR", vectorPaths: source.fillGeometry,
    absoluteTransform: source.absoluteTransform, absoluteBoundingBox: source.absoluteBoundingBox });
}
