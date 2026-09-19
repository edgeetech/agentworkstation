import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPublicationSiteTarget } from '../../../src/domain/publication/configuration';
import { FileSystemPublicationBundleBuilder } from '../../../src/infrastructure/publication/FileSystemPublicationBundleBuilder';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

describe('FileSystemPublicationBundleBuilder', () => {
  it('computes exact hashes in the main-process boundary and assigns the requested roles', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aw-bundle-'));
    await fs.mkdir(path.join(root, 'content'), { recursive: true });
    await fs.mkdir(path.join(root, 'public', 'images'), { recursive: true });
    await fs.writeFile(path.join(root, 'content', 'article.md'), 'primary');
    await fs.writeFile(path.join(root, 'content', 'article.tr.md'), 'translation');
    await fs.writeFile(path.join(root, 'public', 'images', 'hero.webp'), 'visual');
    const target = createPublicationSiteTarget({
      displayDomain: 'example.com', workspaceId: 'site', contentDirectory: 'content',
      publishBranch: 'main', approvedAssetDirectories: ['public/images'],
    });

    const bundle = await new FileSystemPublicationBundleBuilder({ getWorkspaceRoot: () => root }).build(target, {
      contentId: 'article-1',
      primaryArticlePath: 'content/article.md',
      translationPaths: ['content/article.tr.md'],
      visualAssetPaths: ['public/images/hero.webp'],
    });

    expect(bundle.artifacts).toEqual([
      { path: 'content/article.md', role: 'primary-article', sha256: hash('primary') },
      { path: 'content/article.tr.md', role: 'translation', sha256: hash('translation') },
      { path: 'public/images/hero.webp', role: 'visual-asset', sha256: hash('visual') },
    ]);
  });

  it('rejects article files outside the content folder and assets outside approved folders', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aw-bundle-'));
    await fs.mkdir(path.join(root, 'content'), { recursive: true });
    await fs.mkdir(path.join(root, 'private'), { recursive: true });
    await fs.writeFile(path.join(root, 'content', 'article.md'), 'primary');
    await fs.writeFile(path.join(root, 'private', 'translation.md'), 'translation');
    await fs.writeFile(path.join(root, 'private', 'asset.txt'), 'asset');
    const target = createPublicationSiteTarget({
      displayDomain: 'example.com', workspaceId: 'site', contentDirectory: 'content', publishBranch: 'main',
    });
    const builder = new FileSystemPublicationBundleBuilder({ getWorkspaceRoot: () => root });

    await expect(builder.build(target, {
      contentId: 'article-1', primaryArticlePath: 'content/article.md',
      translationPaths: ['private/translation.md'],
    })).rejects.toThrow('translation must be inside');
    await expect(builder.build(target, {
      contentId: 'article-1', primaryArticlePath: 'content/article.md',
      translationPaths: ['content/article.md'], otherAssetPaths: ['private/asset.txt'],
    })).rejects.toThrow(/unique|approved asset folder/);
  });
});
