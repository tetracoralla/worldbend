// @generated from worldbend-core material preference fields; do not edit.
import Foundation

enum WorldbendMaterialPreferenceRules {
    static let families: [String: [String: WorldbendMaterialFieldRule]] = [
        "foil": [
            "visible": .init(property: "visible", kind: "toggle", range: nil, unit: "toggle", direction: "show material", moving: false),
            "base-color": .init(property: "baseColor", kind: "rgba", range: nil, unit: "srgb-rgba", direction: "base tint and coverage", moving: false),
            "highlight-color": .init(property: "highlightColor", kind: "rgba", range: nil, unit: "srgb-rgba", direction: "highlight tint and coverage", moving: false),
            "light-angle": .init(property: "lightAngle", kind: "number", range: [0.0, 360.0], unit: "degrees", direction: "rotate incident light", moving: false),
            "intensity": .init(property: "intensity", kind: "number", range: [0.0, 1.0], unit: "ratio", direction: "increase highlight response", moving: false),
            "roughness": .init(property: "roughness", kind: "number", range: [0.0, 1.0], unit: "ratio", direction: "soften specular detail", moving: false),
            "flow-speed": .init(property: "flowSpeed", kind: "number", range: [0.0, 2.0], unit: "multiplier", direction: "increase flow speed", moving: true),
        ],
        "mesh-gradient": [
            "visible": .init(property: "visible", kind: "toggle", range: nil, unit: "toggle", direction: "show material", moving: false),
            "color-tl": .init(property: "colorTl", kind: "rgba", range: nil, unit: "srgb-rgba", direction: "top-left tint and coverage", moving: false),
            "color-tr": .init(property: "colorTr", kind: "rgba", range: nil, unit: "srgb-rgba", direction: "top-right tint and coverage", moving: false),
            "color-bl": .init(property: "colorBl", kind: "rgba", range: nil, unit: "srgb-rgba", direction: "bottom-left tint and coverage", moving: false),
            "color-br": .init(property: "colorBr", kind: "rgba", range: nil, unit: "srgb-rgba", direction: "bottom-right tint and coverage", moving: false),
            "warp": .init(property: "warp", kind: "number", range: [0.0, 1.0], unit: "ratio", direction: "increase fluid domain warp", moving: false),
            "softness": .init(property: "softness", kind: "number", range: [0.0, 1.0], unit: "ratio", direction: "blend corner regions more softly", moving: false),
            "duration-ms": .init(property: "durationMs", kind: "number", range: [100.0, 60000.0], unit: "milliseconds", direction: "lengthen the authored loop", moving: true),
            "phase-ms": .init(property: "phaseMs", kind: "number", range: [0.0, 60000.0], unit: "milliseconds", direction: "offset the loop phase", moving: true),
            "flow-speed": .init(property: "flowSpeed", kind: "number", range: [0.0, 2.0], unit: "multiplier", direction: "increase motion energy", moving: true),
        ],
    ]
}
