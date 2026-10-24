import type { ReactNode } from 'react';
import type { Tool } from './WhiteboardCanvas';

type IconName = Tool | 'undo' | 'redo' | 'file' | 'save' | 'answers' | 'more' | 'clear';
const icons: Record<IconName, ReactNode> = {
  undo: <path d="m8 4-5 5 5 5M4 9h9a7 7 0 0 1 0 14" />,
  redo: <path d="m16 4 5 5-5 5m4-5h-9a7 7 0 0 0 0 14" />,
  pan: <path d="M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-3 8-7 8h-1c-3 0-4-2-6-4l-3-4a2 2 0 0 1 3-3l2 2" />,
  pen: <path d="m4 16 12-12 4 4L8 20l-5 1zM14 6l4 4M4 16l4 4" />,
  erase: <path d="m3 14 9-10a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-8 8H8zM8 9l10 9M13 21h9" />,
  highlighter: <path d="m7 14 9-11 5 5-11 9zM7 14l3 3-3 4H2l3-5M3 23h11" />,
  select: <path d="m5 3 15 10-7 1-4 7z" />,
  text: <path d="M4 4h16M12 4v16M8 20h8" />,
  line: <path d="M5 20 19 4" />,
  arrow: <path d="M3 12h18m-6-6 6 6-6 6" />,
  rect: <rect x="3" y="5" width="18" height="14" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="10" ry="8" />,
  laser: <><path d="m3 21 8-8m4-5 1-4m3 8 4-1m-8 7 2 4M8 8 5 5" /><circle cx="13" cy="11" r="2" /></>,
  file: <path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8m-8 4h8" />,
  save: <path d="M4 3h14l3 3v15H3V3zm3 0v6h10V3M7 21v-8h10v8" />,
  answers: <><rect x="2" y="3" width="20" height="18" rx="3" /><path d="M9 3v18M5 8h1m-1 4h1" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  clear: <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />,
};

export function BoardToolbarIcon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{icons[name]}</svg>;
}
