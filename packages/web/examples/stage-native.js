// Independent host baseline, version 1. No Worldbend imports or geometry.
// Offsets are authored for a 600 × 400 stage. Scale the stage as a whole.
export const nativeStage = Object.freeze({
  id:'host-offsets', version:'1', width:600, height:400,
  offsets:Object.freeze({background:[3.6,2.4],middle:[8.4,5.6],foreground:[15.6,10.4]}),
});
export function moveNativeStage(slots, state) {
  const x=state.reducedMotion?0:state.pointerX, y=state.reducedMotion?0:state.pointerY;
  for(const [id,[dx,dy]] of Object.entries(nativeStage.offsets))
    slots[id].style.transform=`translate(${x*dx}px,${y*dy}px)`;
}
