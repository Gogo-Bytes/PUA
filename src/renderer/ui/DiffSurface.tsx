import { useMemo } from 'react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { RawPatch, type DiffViewProps } from './DiffView';

export default function DiffSurface({ text, theme, loadDiffFiles }: DiffViewProps) {
  const parsed = useMemo(() => {
    try { return parsePatchFiles(text, undefined, true).flatMap(patch => patch.files); }
    catch { return []; }
  }, [text]);
  const options = useMemo(() => ({
    diffStyle: 'unified' as const, diffIndicators: 'bars' as const,
    disableFileHeader: true, theme: { light: 'pierre-light', dark: 'pierre-dark' }, themeType: theme,
    preferredHighlighter: 'shiki-js' as const, hunkSeparators: 'line-info' as const,
    overflow: 'scroll' as const, tokenizeMaxLineLength: 1000, maxLineDiffLength: 1000,
    expandUnchanged: true,
    loadDiffFiles: loadDiffFiles ? async (fileDiff: FileDiffMetadata) => {
      const loaded = await loadDiffFiles(fileDiff);
      if (loaded.oldFile === null) return { oldFile: null, newFile: loaded.newFile! };
      if (loaded.newFile === null) throw new Error('删除文件没有可加载的新文件内容');
      return { oldFile: loaded.oldFile, newFile: loaded.newFile };
    } : undefined,
  }), [theme, loadDiffFiles]);
  return parsed.length && parsed.every(file => file.hunks.length) ? <>{parsed.map((fileDiff, index) => <FileDiff key={index} fileDiff={fileDiff} options={options}/>)}</> : <RawPatch text={text}/>;
}
