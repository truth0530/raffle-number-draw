import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "현장 추첨",
  description: "QR 응모 → 유리병 버블 연출 → 물리 추첨. 번호표 추첨과 리허설 샌드박스까지, 행사장 현장 추첨 웹앱.",
  openGraph: {
    title: "현장 추첨",
    description: "QR로 응모하고 무대의 유리병에서 당첨자가 뽑히는 현장 추첨",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
