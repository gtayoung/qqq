import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QQQ 周度定投信号',
  description: '基于 Yahoo Finance 数据的 QQQ 周度定投温度分可视化查询。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
