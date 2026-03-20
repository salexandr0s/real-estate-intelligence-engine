export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function piecewiseLinear(x: number, breakpoints: Array<[number, number]>): number {
  if (breakpoints.length === 0) return 0;
  if (x <= breakpoints[0]![0]) return breakpoints[0]![1];
  const last = breakpoints[breakpoints.length - 1]!;
  if (x >= last[0]) return last[1];

  for (let i = 1; i < breakpoints.length; i++) {
    const [x0, y0] = breakpoints[i - 1]!;
    const [x1, y1] = breakpoints[i]!;
    if (x >= x0 && x <= x1) {
      if (x1 === x0) return y0;
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}
