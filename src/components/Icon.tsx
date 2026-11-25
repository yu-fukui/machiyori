// 線で描く小さなアイコン（メニュー・カード型のボタン用）。色は文字の色にそろう
const PATHS = {
  order: <><circle cx="9" cy="20" r="1.2" /><circle cx="18" cy="20" r="1.2" /><path d="M2.5 3h2.2l2.4 11.2a1.8 1.8 0 0 0 1.8 1.4h8.6a1.8 1.8 0 0 0 1.8-1.4L21 7H6" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
  monthly: <><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" /><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h7" /></>,
  finance: <><path d="M3 20h18" /><path d="M6 16v-4M11 16V8M16 16v-6M21 16V5" /></>,
  items: <><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>,
  suppliers: <><path d="M14 17V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a1 1 0 0 0 1 1h2" /><path d="M15 17H9M19 17h2a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.2-.6l-3.5-4.4a1 1 0 0 0-.8-.4H14" /><circle cx="17" cy="17" r="2" /><circle cx="7" cy="17" r="2" /></>,
  stores: <><path d="M3.5 9 5 4h14l1.5 5" /><path d="M4.5 9v11h15V9M3.5 9h17" /><path d="M9.5 20v-5h5v5" /></>,
  staff: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7.5" r="3.5" /><path d="M22 20v-1.5a4 4 0 0 0-3-3.9M16 4.1a4 4 0 0 1 0 7.8" /></>,
  settings: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5" /></>,
  upload: <><path d="M21 15v3.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V15" /><path d="m17 8-5-5-5 5M12 3v12" /></>,
  download: <><path d="M21 15v3.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V15" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  print: <><path d="M6 9V3h12v6" /><path d="M6 18H4.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H18" /><path d="M6 14h12v7H6z" /></>,
  mail: <><rect x="2.5" y="4.5" width="19" height="15" rx="2" /><path d="m3 6 9 7 9-7" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
} as const

export type IconName = keyof typeof PATHS

export default function Icon({ name, className = 'ico' }: { name: IconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{PATHS[name]}</svg>
}
