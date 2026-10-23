import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteSchema } from '../src/lib/schema';
import { makeModel, type Post, type Input } from '../src/lib/model';
import { postSchema } from '../src/lib/schema';

test('dotted S3 bucket is accepted by the canonical site schema', () => {
  const site = siteSchema.parse({
    domain: 'example.org', title: 'Example', description: 'Example website',
    author: 'Editor', media: { bucket: 'assets.example.org' },
  });
  assert.equal(site.media.bucket, 'assets.example.org');
  assert.deepEqual(site.headerNavPages, ['about']);
  for (const bad of ['a..b', '.bad', 'bad.', 'bad_bucket']) {
    assert.throws(() => siteSchema.parse({
      domain: 'example.org', title: 'Example', description: 'Example website',
      author: 'Editor', media: { bucket: bad },
    }), bad);
  }
});

test('posts with identical slug in distinct categories do not fabricate ambiguous /blog redirect', () => {
  const mkPost = (uid: string, category: string): Post => ({
    kind: 'post', file: uid + '.md', body: 'Body',
    data: postSchema.parse({
      uid, title: uid, slug: 'shared', category, description: 'Description',
      draft: false, publishedAt: '2026-01-01',
    }),
  });
  const input: Input = {
    posts: [mkPost('alpha', 'a'), mkPost('beta', 'b')],
    pages: [], cpts: [],
    categories: [
      { id: 'a', name: 'A', slug: 'a', description: 'A', indexable: true },
      { id: 'b', name: 'B', slug: 'b', description: 'B', indexable: true },
    ],
    tags: [], topics: [],
  };
  const site = siteSchema.parse({
    domain: 'example.org', title: 'Example', description: 'Example website',
    author: 'Editor', media: { bucket: 'assets.example.org' },
  });
  const model = makeModel(input, site, new Date('2026-10-24T01:00:00Z'));
  assert.ok(model.byPath.has('/a/shared/'));
  assert.ok(model.byPath.has('/b/shared/'));
  assert.equal(model.redirects.has('/blog/shared/'), false);
});

test('automatic compatibility URLs cannot evict 1,950 established redirects', () => {
  const posts: Post[] = Array.from({ length: 1960 }, (_, i) => ({
    kind: 'post', file: 'post-' + i + '.md', body: 'Body',
    data: postSchema.parse({
      uid: 'p-' + i, title: 'Post ' + i, slug: 'post-' + i,
      category: 'a', description: 'Description', draft: false, publishedAt: '2026-01-01',
    }),
  }));
  const input: Input = {
    posts, pages: [], cpts: [], tags: [], topics: [],
    categories: [{ id: 'a', name: 'A', slug: 'a', description: 'A', indexable: true }],
  };
  const site = siteSchema.parse({
    domain: 'example.org', title: 'Example', description: 'Example website',
    author: 'Editor', media: { bucket: 'example' },
  });
  const original = makeModel(input, site, new Date('2026-10-24T01:00:00Z'));
  assert.equal(original.redirects.size, 1950);
  assert.equal(original.redirectState.retired.length, 0);
  const repeat = makeModel(input, site, new Date('2026-10-24T01:00:00Z'), false, original.redirectState.history);
  assert.deepEqual([...repeat.redirects], [...original.redirects]);
  assert.equal(repeat.redirectState.retired.length, 0);
});
