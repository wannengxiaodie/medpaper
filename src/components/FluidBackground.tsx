// 科幻流体光影背景：5 团漂移辉光 + 暗色星点网格
export default function FluidBackground() {
  return (
    <div className="fluid-bg" aria-hidden="true">
      <div className="fluid-blob fluid-blob-1" />
      <div className="fluid-blob fluid-blob-2" />
      <div className="fluid-blob fluid-blob-3" />
      <div className="fluid-blob fluid-blob-4" />
      <div className="fluid-blob fluid-blob-5" />
      <div className="fluid-grid" />
    </div>
  );
}
