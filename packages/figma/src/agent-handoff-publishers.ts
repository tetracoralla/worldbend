/**
 * Read/apply runtime entry: document operations and their source
 * exporters, without the material families. Prepared requests embed only the
 * variant they call, keeping every packet inside the 48 KiB budget as the
 * family surface grows. Never import this from plugin UI code.
 */
export {
  inspectEffect,
  inspectEffectWithSources,
  inspectMockup,
  inspectMockupWithSources,
  stageEffect,
  stageMockup,
} from "./agent-handoff";
