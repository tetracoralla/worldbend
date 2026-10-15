import MetalKit
import SwiftUI

/// A decorative background behind real content. The surface owns its clock;
/// a shared session owns material/revision state, not input or product layout.
public struct WorldbendMaterialSurface<Material: WorldbendProceduralMaterial>: View {
    private let session: WorldbendMaterialSession<Material>?
    private let preferenceSession: WorldbendMaterialPreferenceSession<Material>?
    private let suppliedClock: WorldbendMaterialClock?
    private let maxPixels: Int
    private let onError: @MainActor (String) -> Void
    @State private var ownClock = WorldbendMaterialClock()
    @State private var failure: String?
    @State private var rendererEpoch=0
    @State private var activeReceiverIdentity:ObjectIdentifier?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.displayScale) private var displayScale
    private var clock: WorldbendMaterialClock { suppliedClock ?? ownClock }
    private var receiverIdentity:ObjectIdentifier?{if let preferenceSession{return ObjectIdentifier(preferenceSession)};return session.map(ObjectIdentifier.init)}
    private var delivery: WorldbendMaterialDelivery<Material>? {
        if let preferenceSession {return preferenceSession.isRemoved ? nil : preferenceSession.source}
        return session?.delivery
    }
    private var displayedMaterial: Material? { preferenceSession?.displayedMaterial ?? (preferenceSession == nil ? session?.displayedMaterial : nil) }
    public init(_ session: WorldbendMaterialSession<Material>, clock: WorldbendMaterialClock? = nil,
                maxPixels: Int = 16_777_216, onError: @escaping @MainActor (String) -> Void = { _ in }) {
        self.session = session; preferenceSession=nil; suppliedClock = clock; self.maxPixels = maxPixels; self.onError = onError
    }
    public init(_ session: WorldbendMaterialPreferenceSession<Material>, clock: WorldbendMaterialClock? = nil,
                maxPixels: Int = 16_777_216, onError: @escaping @MainActor (String) -> Void = { _ in }) {
        self.session=nil;preferenceSession=session;suppliedClock=clock;self.maxPixels=maxPixels;self.onError=onError
    }
    private func visibility() {clock.setVisible(scenePhase == .active && displayedMaterial?.visible == true)}
    public var body: some View {
        let receiver=receiverIdentity,epoch=rendererEpoch
        return TimelineView(.animation(paused: !clock.running || !(displayedMaterial?.animates ?? false) || preferenceSession?.motionAllowed == false || failure != nil)) { context in
            if let delivery, let material = displayedMaterial {
                WorldbendMaterialNativeSurface(delivery:delivery,material:material,
                    milliseconds:clock.milliseconds(at:context.date),scale:displayScale,maxPixels:maxPixels) { message in
                        guard activeReceiverIdentity==receiver,rendererEpoch==epoch else{return}
                        failure = message;preferenceSession?.setRendererUnavailable();onError(message)
                    }
                    .id(epoch)
                    .id(receiver)
            } else { Color.clear }
        }
        .allowsHitTesting(false).accessibilityHidden(true)
        .onAppear {activeReceiverIdentity=receiverIdentity;clock.setReducedMotion(reduceMotion);preferenceSession?.setSystemReducedMotion(reduceMotion);clock.setRuntimeMotionAllowed(preferenceSession?.motionAllowed ?? true);visibility()}
        .onDisappear { activeReceiverIdentity=nil;clock.setVisible(false) }
        .onChange(of:scenePhase) { _,_ in visibility() }
        .onChange(of:displayedMaterial?.visible) { _,_ in visibility() }
        .onChange(of:preferenceSession?.motionAllowed) { _,value in clock.setRuntimeMotionAllowed(value ?? true) }
        .onChange(of:preferenceSession?.runtime.rendererAvailable) { _,value in if value == true {failure=nil;rendererEpoch+=1} }
        .onChange(of:receiverIdentity) { _,value in activeReceiverIdentity=value;failure=nil;rendererEpoch+=1;preferenceSession?.setSystemReducedMotion(reduceMotion);clock.setRuntimeMotionAllowed(preferenceSession?.motionAllowed ?? true);visibility() }
        .onChange(of:reduceMotion) { _,value in clock.setReducedMotion(value);preferenceSession?.setSystemReducedMotion(value) }
    }
}

private struct WorldbendMaterialNativeSurface<Material: WorldbendProceduralMaterial> {
    let delivery: WorldbendMaterialDelivery<Material>
    let material: Material
    let milliseconds, scale: Double
    let maxPixels: Int
    let onError: @MainActor (String) -> Void
    @MainActor final class Coordinator: NSObject, MTKViewDelegate {
        var renderer: WorldbendMaterialRenderer<Material>?
        var material: Material
        var milliseconds: Double
        var onError: @MainActor (String) -> Void
        private var failed = false
        init(_ owner: WorldbendMaterialNativeSurface) {
            material = owner.material; milliseconds = owner.milliseconds; onError = owner.onError
            do { renderer = try WorldbendMaterialRenderer(owner.delivery) }
            catch {
                renderer = nil; super.init(); fail(error.localizedDescription); return
            }
            super.init()
        }
        func fail(_ message: String) {
            guard !failed else { return }; failed = true
            let callback = onError
            Task { @MainActor in callback(String(message.prefix(512))) }
        }
        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}
        func draw(in view: MTKView) {
            guard !failed, let renderer, let drawable = view.currentDrawable else { return }
            do {
                try renderer.draw(material,milliseconds:milliseconds,into:drawable.texture,present:drawable) { [weak self] command in
                    if let error = command.error {
                        let message = error.localizedDescription
                        Task { @MainActor [weak self] in self?.fail(message) }
                    }
                }
            } catch { fail(error.localizedDescription) }
        }
    }
    @MainActor func makeCoordinator() -> Coordinator { Coordinator(self) }
    @MainActor func makeView(_ coordinator: Coordinator) -> MTKView {
        let view = WorldbendMaterialHostingView(frame:.zero,device:coordinator.renderer?.device)
        view.colorPixelFormat = .bgra8Unorm; view.isPaused = true; view.enableSetNeedsDisplay = false
        view.autoResizeDrawable = false; view.delegate = coordinator
        view.clearColor = MTLClearColorMake(0,0,0,0)
        #if canImport(UIKit)
        view.isOpaque = false; view.backgroundColor = .clear
        (view.layer as? CAMetalLayer)?.colorspace = CGColorSpace(name:CGColorSpace.sRGB)
        #elseif canImport(AppKit)
        view.wantsLayer = true; view.layer?.isOpaque = false; view.layer?.backgroundColor = CGColor.clear
        view.colorspace = CGColorSpace(name:CGColorSpace.sRGB)
        #endif
        return view
    }
    @MainActor func update(_ view: MTKView, coordinator: Coordinator) {
        if coordinator.renderer?.kernelID != delivery.kernel.id {
            do {
                let replacement = try WorldbendMaterialRenderer(delivery,device:coordinator.renderer?.device)
                coordinator.renderer = replacement; view.device = replacement.device
            } catch { coordinator.fail(error.localizedDescription); return }
        }
        coordinator.material = material; coordinator.milliseconds = milliseconds; coordinator.onError = onError
        (view as? WorldbendMaterialHostingView)?.refreshLayout = { [weak view,weak coordinator] in
            guard let view, let coordinator else { return }
            resizeAndDraw(view,coordinator:coordinator)
        }
        resizeAndDraw(view,coordinator:coordinator)
    }
    @MainActor private func resizeAndDraw(_ view: MTKView, coordinator: Coordinator) {
        let width = view.bounds.width * min(scale,2), height = view.bounds.height * min(scale,2)
        guard width.isFinite, height.isFinite, width > 0, height > 0, (width * height).isFinite else { return }
        guard maxPixels > 0 else { coordinator.fail(WorldbendMaterialRenderError.invalidSize.localizedDescription); return }
        let factor = min(1,sqrt(Double(maxPixels) / (width * height)),16384 / width,16384 / height)
        view.drawableSize = CGSize(width:max(1,floor(width * factor)),height:max(1,floor(height * factor)))
        view.draw()
    }
}

@MainActor private final class WorldbendMaterialHostingView: MTKView {
    var refreshLayout: (() -> Void)?
    #if canImport(UIKit)
    override func layoutSubviews() { super.layoutSubviews(); refreshLayout?() }
    #elseif canImport(AppKit)
    override func layout() { super.layout(); refreshLayout?() }
    #endif
}

#if canImport(UIKit)
extension WorldbendMaterialNativeSurface: UIViewRepresentable {
    func makeUIView(context: Context) -> MTKView { makeView(context.coordinator) }
    func updateUIView(_ view: MTKView, context: Context) { update(view,coordinator:context.coordinator) }
    static func dismantleUIView(_ view: MTKView, coordinator: Coordinator) { view.delegate = nil; view.isPaused = true }
}
#elseif canImport(AppKit)
extension WorldbendMaterialNativeSurface: NSViewRepresentable {
    func makeNSView(context: Context) -> MTKView { makeView(context.coordinator) }
    func updateNSView(_ view: MTKView, context: Context) { update(view,coordinator:context.coordinator) }
    static func dismantleNSView(_ view: MTKView, coordinator: Coordinator) { view.delegate = nil; view.isPaused = true }
}
#endif
