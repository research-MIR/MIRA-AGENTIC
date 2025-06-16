interface MaskItem {
  box_2d: [number, number, number, number]; // [y_min, x_min, y_max, x_max] normalized to 1000
  label: string;
}

interface SegmentationMaskProps {
  masks: MaskItem[];
}

export const SegmentationMask = ({ masks }: SegmentationMaskProps) => {
  if (!masks || masks.length === 0) {
    return null;
  }

  return (
    <>
      {masks.map((maskItem, index) => {
        const { box_2d, label } = maskItem;
        const [yMin, xMin, yMax, xMax] = box_2d;

        const top = (yMin / 1000) * 100;
        const left = (xMin / 1000) * 100;
        const boxHeight = ((yMax - yMin) / 1000) * 100;
        const boxWidth = ((xMax - xMin) / 1000) * 100;

        if (boxWidth <= 0 || boxHeight <= 0) return null;

        return (
          <div
            key={index}
            className="absolute border-2 border-red-500 bg-red-500/30 pointer-events-none"
            style={{
              top: `${top}%`,
              left: `${left}%`,
              width: `${boxWidth}%`,
              height: `${boxHeight}%`,
            }}
          >
            <span className="absolute -top-6 left-0 bg-red-500 text-white text-xs font-bold px-1 py-0.5 rounded-sm">
              {label}
            </span>
          </div>
        );
      })}
    </>
  );
};