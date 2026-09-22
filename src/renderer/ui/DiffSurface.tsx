import { useMemo } from 'react';
import { parsePatchFiles } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { RawPatch, type DiffViewProps } from './DiffView';

export default function DiffSurface({ text, theme }: DiffViewProps) {
  const parsed = useMemo(() => {
    try { return parsePatchFiles(text, undefined, true).flatMap(patch => patch.files); }
    catch { return []; }
  }, [text]);
  const options = useMemo(() => ({
    diffStyle: 'unified' as const, diffIndicators: 'bars' as const,
    disableFileHeader: true, theme: { light: 'pierre-light', dark: 'pierre-dark' }, themeType: theme,
    preferredHighlighter: 'shiki-js' as const, hunkSeparators: 'line-info' as const,
    overflow: 'scroll' as const, tokenizeMaxLineLength: 1000, maxLineDiffLength: 1000,
  }), [theme]);
  return parsed.length && parsed.every(file => file.hunks.length) ? <>{parsed.map((fileDiff, index) => <FileDiff key={index} fileDiff={fileDiff} options={options}/>)}</> : <RawPatch text={text}/>;
}
