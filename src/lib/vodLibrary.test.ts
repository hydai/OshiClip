import { describe, expect, it } from "vitest";
import {
  filterVodLibraryCards,
  makeVodLibraryCards,
  matchingVodPerformances,
  performanceToDownloadPrefill,
  shouldAutoSyncVodLibrary,
} from "./vodLibrary";
import type { VodLibraryDataset } from "../types";

const DATASET: VodLibraryDataset = {
  schemaVersion: "1.0.0",
  publishedAt: "2026-07-11T20:04:22.682Z",
  syncedAt: "2026-07-15T12:00:00.000Z",
  sha256: "abc",
  counts: { streamers: 2, vods: 2, performances: 3 },
  streamers: [
    {
      slug: "alpha",
      displayName: "Alpha",
      group: "Group A",
      vods: [
        {
          title: "夏日歌回",
          date: "2026-07-10",
          videoId: "abcdefghijk",
          performances: [
            {
              performanceId: "p-1",
              title: "Blue Sky",
              originalArtist: "Singer One",
              startSeconds: 120,
              endSeconds: 240,
            },
            {
              performanceId: "p-2",
              title: "月光",
              originalArtist: null,
              startSeconds: 300,
              endSeconds: 420,
            },
          ],
        },
      ],
    },
    {
      slug: "beta",
      displayName: "Beta",
      group: null,
      vods: [
        {
          title: "Archive",
          date: "2026-06-01",
          videoId: "lmnopqrstuv",
          performances: [
            {
              performanceId: "p-3",
              title: "Starlight",
              originalArtist: "Singer Two",
              startSeconds: 12,
              endSeconds: 90,
            },
          ],
        },
      ],
    },
  ],
};

describe("shouldAutoSyncVodLibrary", () => {
  const now = Date.parse("2026-07-16T12:00:00.000Z");

  it("syncs at 24 hours but keeps a newer cache", () => {
    expect(
      shouldAutoSyncVodLibrary("2026-07-15T12:00:00.001Z", now),
    ).toBe(false);
    expect(
      shouldAutoSyncVodLibrary("2026-07-15T12:00:00.000Z", now),
    ).toBe(true);
  });

  it("recovers from invalid or implausibly future timestamps", () => {
    expect(shouldAutoSyncVodLibrary("invalid", now)).toBe(true);
    expect(
      shouldAutoSyncVodLibrary("2026-07-16T12:06:00.000Z", now),
    ).toBe(true);
  });
});

describe("VOD library helpers", () => {
  const cards = makeVodLibraryCards(DATASET);

  it("searches VOD, streamer, song, and artist text", () => {
    expect(
      filterVodLibraryCards(cards, {
        query: "ＳＩＮＧＥＲ　ＯＮＥ",
        streamerSlug: "",
        sort: "newest",
      }).map((card) => card.id),
    ).toEqual(["alpha:abcdefghijk"]);
  });

  it("filters by streamer and sorts oldest first", () => {
    expect(
      filterVodLibraryCards(cards, {
        query: "",
        streamerSlug: "beta",
        sort: "oldest",
      }).map((card) => card.id),
    ).toEqual(["beta:lmnopqrstuv"]);
  });

  it("shows only matching songs unless the VOD metadata matched", () => {
    expect(
      matchingVodPerformances(cards[0], "月光").map(
        (performance) => performance.performanceId,
      ),
    ).toEqual(["p-2"]);
    expect(matchingVodPerformances(cards[0], "Alpha")).toHaveLength(2);
  });

  it("turns one performance into a safe download prefill", () => {
    expect(
      performanceToDownloadPrefill(
        DATASET.streamers[0],
        DATASET.streamers[0].vods[0],
        DATASET.streamers[0].vods[0].performances[0],
      ),
    ).toEqual({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      startSeconds: 120,
      endSeconds: 240,
      filenameMetadata: {
        streamer: "Alpha",
        songTitle: "Blue Sky",
        artist: "Singer One",
        vodTitle: "夏日歌回",
        vodDate: "2026-07-10",
      },
    });
  });
});
