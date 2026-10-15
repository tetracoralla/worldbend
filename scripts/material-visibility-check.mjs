// Browser-side receiving check. Observe actual intersection delivery and frame
// progress instead of assuming two animation frames fit in a fixed 100 ms.
export async function checkMaterialVisibility(handle, element, pixels, timeoutMs = 5000) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const require = (condition, message) => { if (!condition) throw Error(message); };
  let intersecting;
  const observer = new IntersectionObserver(entries => {
    intersecting = entries.at(-1).isIntersecting;
  });
  const until = async (condition, message) => {
    const deadline = performance.now() + timeoutMs;
    while (!condition() && performance.now() < deadline) await wait(20);
    require(condition(), message + ': ' + JSON.stringify({intersecting, state: handle.getState(), bounds: element.getBoundingClientRect().toJSON()}));
  };
  const position = element.style.position, top = element.style.top;
  observer.observe(element);
  try {
    handle.setPaused(false);
    element.style.position = 'absolute'; element.style.top = '3000px';
    await until(() => intersecting === false, 'offscreen intersection was not observed');
    const offscreenTime = handle.getState().time;
    await wait(100);
    require(handle.getState().time === offscreenTime, 'offscreen instance kept advancing');
    const stoppedPixels = await pixels(element);
    element.style.position = position; element.style.top = top;
    await until(() => intersecting === true && handle.getState().time >= offscreenTime + 200, 'reinserted visible instance did not resume');
    handle.setPaused(true);
    const resumedTime = handle.getState().time, resumedPixels = await pixels(element);
    require(resumedPixels.some((value, index) => value !== stoppedPixels[index]), 'resumed clock did not change actual material pixels');
    return {offscreenTime, resumedTime, browserIntersectionObserved: true, resumedPixelsChanged: true};
  } finally {
    observer.disconnect(); element.style.position = position; element.style.top = top;
  }
}

export const materialVisibilityCheckScript = `const checkMaterialVisibility = (${checkMaterialVisibility});`;
