/**
 * Workflow icons, one per workflow, readable without the name (32 pt grid).
 *
 * Grammar: an image is a frame with a ridge, a video a frame with a play
 * triangle, text three lines, an idea a bulb. Conversions read input → output
 * (Text → Image, Image → Video…); edits show the tool on the image (brush,
 * viewfinder, crop marks, outward arrows).
 *
 * `knockout` is the colour behind the icon (its tile), used where a shape
 * must hide the lines it overlaps (the edit bubble over its frame).
 */

import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

export type WorkflowIconKey =
  | 't2i'
  | 'i2i'
  | 'edit'
  | 'depth'
  | 'repaint'
  | 'context'
  | 'drawReplace'
  | 'inpaint'
  | 'detect'
  | 'outpaint'
  | 'upscale'
  | 'video'
  | 't2v'
  | 'i2v'
  | 'flf'
  | 'prompt'
  | 'idea2prompt'
  | 'img2prompt'
  | 'import'
  | 'graph';

/** Icons an imported workflow can pick (the import arrow is the action, not a workflow). */
export const PICKABLE_ICONS: WorkflowIconKey[] = [
  'graph', 't2i', 'i2i', 'edit', 'depth', 'repaint', 'context', 'drawReplace',
  'inpaint', 'detect', 'outpaint', 'upscale', 'video', 't2v', 'i2v', 'flf',
  'prompt', 'idea2prompt', 'img2prompt',
];

const KEYS = new Set<string>([...PICKABLE_ICONS, 'import']);

/** Manifests imported before icons existed hold an Ionicons name. */
export function isWorkflowIconKey(value: string): value is WorkflowIconKey {
  return KEYS.has(value);
}

interface Props {
  name: WorkflowIconKey;
  color: string;
  knockout?: string;
  size?: number;
}

export function WorkflowIcon({ name, color, knockout = 'transparent', size = 30 }: Props) {
  const s = {
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  const dashed = { ...s, strokeDasharray: '2.6 2.6' };
  const solid = { fill: color };
  const tint = { fill: color, fillOpacity: 0.28 };
  const arrow = <Path d="M14 16h4.2M16.3 13.8l2.2 2.2-2.2 2.2" {...s} />;

  // Input / output glyphs of the conversion icons (11 pt boxes).
  const textLeft = <Path d="M1 12.5h11M1 16h11M1 19.5h7" {...s} />;
  const textRight = <Path d="M20 12.5h11M20 16h11M20 19.5h7" {...s} />;
  const imageLeft = (
    <>
      <Rect x={1} y={10.5} width={11} height={11} rx={2.3} {...s} />
      <Path d="M1 18.5l3.6-3.6 2.7 2.7 1.8-1.8 2.9 2.9" {...s} />
      <Circle cx={8.6} cy={13.7} r={1} {...s} />
    </>
  );
  const imageRight = (
    <>
      <Rect x={20} y={10.5} width={11} height={11} rx={2.3} {...s} />
      <Path d="M20 18.5l3.6-3.6 2.7 2.7 1.8-1.8 2.9 2.9" {...s} />
      <Circle cx={27.6} cy={13.7} r={1} {...s} />
    </>
  );
  const videoRight = (
    <>
      <Rect x={20} y={10.5} width={11} height={11} rx={2.3} {...s} />
      <Path d="M24.2 13.3l4.3 2.7-4.3 2.7z" {...solid} />
    </>
  );
  const cropCorners = <Path d="M3 9V4h5M24 4h5v5M29 23v5h-5M8 28H3v-5" {...s} />;

  let body: React.ReactNode;
  switch (name) {
    case 't2i':
      body = <>{textLeft}{arrow}{imageRight}</>;
      break;
    case 'i2i':
      body = (
        <>
          {imageLeft}
          {arrow}
          {imageRight}
          <Path d="M29.5 2.8l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8z" {...solid} />
        </>
      );
      break;
    case 'edit':
      body = (
        <>
          <Rect x={2} y={10} width={21} height={18} rx={3} {...s} />
          <Path d="M2 24l5.5-5.5 4 4 3-3 6.5 6.5" {...s} />
          <Path
            d="M19.5 2.5h9a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-4.5l-3.5 3v-3h-1a2.5 2.5 0 0 1-2.5-2.5v-5a2.5 2.5 0 0 1 2.5-2.5z"
            {...s}
            fill={knockout}
          />
          <Path d="M20.5 6.3h7M20.5 9.2h4.5" {...s} />
        </>
      );
      break;
    case 'depth':
      body = (
        <>
          <Rect x={2.5} y={4.5} width={27} height={23} rx={3} {...s} />
          <Ellipse cx={16} cy={18} rx={10} ry={6} {...s} />
          <Ellipse cx={16} cy={18.6} rx={6} ry={3.4} {...s} />
          <Ellipse cx={16} cy={19} rx={2.2} ry={1.2} {...solid} />
        </>
      );
      break;
    case 'repaint':
      body = (
        <>
          <Rect x={2.5} y={9} width={20} height={18.5} rx={3} {...s} />
          <Path d="M7 22.5c-1-3 1-6 4.5-6.5s6 2 5 4.5-3.5 4-6 4-3 0-3.5-2z" {...tint} />
          <Path d="M29.5 3L22 10.5" {...s} />
          <Path d="M22 10.5c-2.4-.4-4.4 1.3-4.4 3.8 0 1.1-.6 1.9-1.6 2.5 4 .7 7.3-1.8 6-6.3z" {...solid} />
        </>
      );
      break;
    case 'context':
      body = (
        <>
          <Rect x={2.5} y={4.5} width={27} height={23} rx={3} {...s} />
          <Path d="M2.5 22l6-6 4 4" {...s} />
          <Circle cx={24} cy={10.5} r={2} {...s} />
          <Circle cx={17} cy={14.5} r={3} {...dashed} />
          <Path d="M11 27.5c0-4 2.7-6.5 6-6.5s6 2.5 6 6.5" {...dashed} />
        </>
      );
      break;
    case 'drawReplace':
      body = (
        <>
          <Path d="M8 2v6H2M24 2v6h6M24 30v-6h6M8 30v-6H2" {...s} />
          <Path d="M9 19c1.8-4.5 4-5 5.2-1.8s3.2 3.1 4.6-.2 3.4-4.4 5.2-1.2" {...s} strokeWidth={2.8} />
        </>
      );
      break;
    case 'inpaint':
      body = (
        <>
          <Rect x={2.5} y={4.5} width={27} height={23} rx={3} {...s} />
          <Path d="M10 20.5c-1.5-3.5 1-7 5-7.2s7.5 1.8 7 5.2-4 4.8-7.2 4.6-3.8-.6-4.8-2.6z" {...tint} />
          <Path d="M10 20.5c-1.5-3.5 1-7 5-7.2s7.5 1.8 7 5.2-4 4.8-7.2 4.6-3.8-.6-4.8-2.6z" {...s} />
        </>
      );
      break;
    case 'detect':
      body = (
        <>
          {cropCorners}
          <Circle cx={16} cy={13.5} r={3.6} {...s} />
          <Path d="M9.5 25c.8-3.6 3.4-5.6 6.5-5.6s5.7 2 6.5 5.6" {...s} />
        </>
      );
      break;
    case 'outpaint':
      body = (
        <>
          <Rect x={1.5} y={3.5} width={29} height={25} rx={3} {...dashed} />
          <Rect x={10} y={10} width={12} height={12} rx={2} {...s} />
          <Path d="M10 19.5l3.2-3.2 2.4 2.4 1.6-1.6 2.8 2.8" {...s} />
          <Path
            d="M8 16H4.5M6.3 14.2L4.5 16l1.8 1.8M24 16h3.5M25.7 14.2l1.8 1.8-1.8 1.8M16 8V5.5M14.4 7.1L16 5.5l1.6 1.6M16 24v2.5M14.4 24.9l1.6 1.6 1.6-1.6"
            {...s}
          />
        </>
      );
      break;
    case 'upscale':
      body = (
        <>
          <Rect x={3} y={3} width={26} height={26} rx={3} {...dashed} />
          <Rect x={3} y={17} width={12} height={12} rx={2.3} {...s} />
          <Path d="M12.5 19.5L25 7M18.5 7H25v6.5" {...s} />
        </>
      );
      break;
    case 'video':
      body = (
        <>
          <Rect x={2} y={7} width={20} height={18} rx={3.5} {...s} />
          <Path d="M9.5 12.2l6.3 3.8-6.3 3.8z" {...solid} />
          <Path d="M25 12.5a5 5 0 0 1 0 7M28 9.5a9 9 0 0 1 0 13" {...s} />
        </>
      );
      break;
    case 't2v':
      body = <>{textLeft}{arrow}{videoRight}</>;
      break;
    case 'i2v':
      body = <>{imageLeft}{arrow}{videoRight}</>;
      break;
    case 'flf':
      body = (
        <>
          <Rect x={1.5} y={9} width={29} height={14} rx={2.5} {...s} />
          <Path d="M8.75 9v14M16 9v14M23.25 9v14" {...s} />
          <Path
            d="M4 9h4.75v14H4a2.5 2.5 0 0 1-2.5-2.5v-9A2.5 2.5 0 0 1 4 9zM23.25 9H28a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 28 23h-4.75z"
            {...tint}
          />
          <Circle cx={12.4} cy={16} r={1.1} {...solid} />
          <Circle cx={19.6} cy={16} r={1.1} {...solid} />
        </>
      );
      break;
    case 'prompt':
      body = (
        <>
          <Path d="M4 10h13M4 16h21M4 22h16" {...s} />
          <Path d="M25.5 3.5l1 2.9 2.9 1-2.9 1-1 2.9-1-2.9-2.9-1 2.9-1z" {...solid} />
        </>
      );
      break;
    case 'idea2prompt':
      body = (
        <>
          <Path d="M4.4 18a4.1 4.1 0 1 1 4.2 0c-.5.4-.7.9-.7 1.4H5.1c0-.5-.2-1-.7-1.4zM5.3 21.5h2.4" {...s} />
          {arrow}
          {textRight}
        </>
      );
      break;
    case 'img2prompt':
      body = <>{imageLeft}{arrow}{textRight}</>;
      break;
    case 'import':
      body = (
        <Path
          d="M10.5 5.5c-2.6 0-3.5 1.3-3.5 3.5v3.5c0 1.8-1.2 3.5-3 3.5 1.8 0 3 1.7 3 3.5V23c0 2.2.9 3.5 3.5 3.5M21.5 5.5c2.6 0 3.5 1.3 3.5 3.5v3.5c0 1.8 1.2 3.5 3 3.5-1.8 0-3 1.7-3 3.5V23c0 2.2-.9 3.5-3.5 3.5M16 12v8M12 16h8"
          {...s}
        />
      );
      break;
    case 'graph':
    default:
      body = (
        <>
          <Rect x={2.5} y={5} width={9} height={7} rx={2} {...s} />
          <Rect x={20.5} y={12.5} width={9} height={7} rx={2} {...s} />
          <Rect x={2.5} y={20} width={9} height={7} rx={2} {...s} />
          <Path d="M11.5 8.5c4.5 0 4.5 7.5 9 7.5M11.5 23.5c4.5 0 4.5-7.5 9-7.5" {...s} />
        </>
      );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      {body}
    </Svg>
  );
}
