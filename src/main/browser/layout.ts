import { LAYOUT, type Bounds, type ViewportRequest } from '../../shared/contracts';

export function safeBounds(request: ViewportRequest, width: number, height: number): Bounds {
  const left = Math.min(width, Math.max(0, request.x));
  const top = Math.min(height, Math.max(LAYOUT.toolbarHeight, request.y));
  const right = Math.min(Math.max(0, width - LAYOUT.sidebarWidth), request.x + request.width);
  const bottom = Math.min(height, request.y + request.height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
