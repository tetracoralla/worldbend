import SwiftUI

@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *)
extension View {
  /// Worldbend appearance delivery — recipe "optical-lab-clear" v2.
  /// Applies the system Liquid Glass material on iOS 26+.
  func worldbendGlass(cornerRadius: CGFloat) -> some View {
    self.glassEffect(true ? .regular.interactive() : .identity, in: .rect(cornerRadius: cornerRadius))
  }
}

@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *)
struct NativeGlassDeliveryExample: View {
  var body: some View {
    ZStack {
      LinearGradient(colors: [.blue, .purple, .orange], startPoint: .topLeading, endPoint: .bottomTrailing)
      Button("Explore the ridge") {}
        .padding(24)
        .worldbendGlass(cornerRadius: 40)
    }
  }
}
