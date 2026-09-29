/**
 * The default `Persistence`: links (`link.ts`), files (`files.ts`) and merging (`conflicts.ts`)
 * over a `BlobStore` and a `DesignRepository`, both injected so tests and replacements can
 * supply their own.
 */
import { copyDesign, type Design } from 'shaping';
import { planMerge, resolveMerge } from './conflicts';
import { exportCollection, exportDesign, parseFile, remapImages, restoreImages } from './files';
import { designFromLink, shareLink } from './link';
import type { BlobStore, DesignRepository, ImportDecision, ImportPlan, ImportSummary, ParsedFile, Persistence } from './types';

/** The address links are built on: this page, without its query or hash. */
const pageBase = () => location.origin + location.pathname;

export function createPersistence({ blobs, repo, base = pageBase }: { blobs: BlobStore; repo: DesignRepository; base?: () => string }): Persistence {
  const kept = async (): Promise<Design[]> => (await repo.list()).map((s) => s.design);

  async function planImport(file: ParsedFile): Promise<ImportPlan> {
    const existing = Object.fromEntries((await kept()).map((d) => [d.id, d]));
    if (file.kind === 'design') return planMerge(existing, { [file.design.id]: file.design }, { images: file.images });
    return planMerge(existing, file.items, { rejected: file.rejected, images: file.images });
  }

  async function applyImport(plan: ImportPlan, decision: ImportDecision): Promise<ImportSummary> {
    const { writes, summary } = resolveMerge(plan, decision);
    const items = Object.values(writes);
    const { map, missing } = await restoreImages(items, plan.images, blobs);
    for (const d of items) await repo.save(remapImages(d, map));
    return { ...summary, rejected: plan.rejected, missingImages: missing };
  }

  return {
    shareLink: (design, at = base()) => shareLink(design, at, blobs),
    designFromLink,
    exportDesign: (design, options) => exportDesign(design, options, blobs),
    exportCollection: async (options) => exportCollection(await kept(), options, blobs),
    parseFile,
    async openDesignFile(file) {
      const { map } = await restoreImages([file.design], file.images, blobs);
      return copyDesign(remapImages(file.design, map));
    },
    planImport,
    applyImport,
  };
}
