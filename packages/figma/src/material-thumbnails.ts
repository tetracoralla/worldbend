// Native glass/paper renders and canonical WebGPU Foil and mesh-gradient renders
// of the chooser recipes. Shader swatches precede native composition and adoption.
import clear from "../assets/materials/clear-lens.jpg";
import frost from "../assets/materials/frosted-panel.jpg";
import prism from "../assets/materials/prism-edge.jpg";
import paper from "../assets/materials/warm-paper.jpg";
import etched from "../assets/materials/etched-card.jpg";
import plastic from "../assets/materials/frosted-plastic.jpg";
import warmFoil from '../assets/materials/warm-foil.jpg';
import silverFoil from '../assets/materials/silver-foil.jpg';
import roseFoil from '../assets/materials/rose-foil.jpg';
import softFluid from '../assets/materials/soft-fluid.jpg';
import dawnWash from '../assets/materials/dawn-wash.jpg';
import nightCurrent from '../assets/materials/night-current.jpg';
export const MATERIAL_THUMBNAILS: Record<string, string> = {
  "clear-lens": clear,
  "frosted-panel": frost,
  "prism-edge": prism,
  "warm-paper": paper,
  "etched-card": etched,
  "frosted-plastic": plastic,
  'warm-foil':warmFoil,'silver-foil':silverFoil,'rose-foil':roseFoil,
  'soft-fluid':softFluid,'dawn-wash':dawnWash,'night-current':nightCurrent,
};
