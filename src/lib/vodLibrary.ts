import type {
  DownloadPrefill,
  VodLibraryDataset,
  VodLibraryPerformance,
  VodLibraryStreamer,
  VodLibraryVod,
} from "../types";

export type VodLibrarySort = "newest" | "oldest";

export const VOD_LIBRARY_AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function shouldAutoSyncVodLibrary(
  syncedAt: string,
  now = Date.now(),
): boolean {
  const syncedAtMs = Date.parse(syncedAt);
  if (!Number.isFinite(syncedAtMs)) return true;
  if (syncedAtMs > now + MAX_FUTURE_CLOCK_SKEW_MS) return true;
  return now - syncedAtMs >= VOD_LIBRARY_AUTO_SYNC_INTERVAL_MS;
}

export interface VodLibraryCard {
  id: string;
  streamer: VodLibraryStreamer;
  vod: VodLibraryVod;
  searchText: string;
  metadataSearchText: string;
}

export interface VodLibraryFilters {
  query: string;
  streamerSlug: string;
  sort: VodLibrarySort;
}

export function normalizeVodQuery(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("zh-TW");
}

function searchableText(values: Array<string | null>): string {
  return normalizeVodQuery(values.filter(Boolean).join("\u0000"));
}

export function makeVodLibraryCards(
  dataset: VodLibraryDataset,
): VodLibraryCard[] {
  return dataset.streamers.flatMap((streamer) =>
    streamer.vods.map((vod) => {
      const metadataSearchText = searchableText([
        streamer.displayName,
        streamer.group,
        vod.title,
      ]);
      return {
        id: `${streamer.slug}:${vod.videoId}`,
        streamer,
        vod,
        metadataSearchText,
        searchText: searchableText([
          metadataSearchText,
          ...vod.performances.flatMap((performance) => [
            performance.title,
            performance.originalArtist,
          ]),
        ]),
      };
    }),
  );
}

export function filterVodLibraryCards(
  cards: VodLibraryCard[],
  filters: VodLibraryFilters,
): VodLibraryCard[] {
  const query = normalizeVodQuery(filters.query);
  const filtered = cards.filter(
    (card) =>
      (!filters.streamerSlug || card.streamer.slug === filters.streamerSlug) &&
      (!query || card.searchText.includes(query)),
  );

  return [...filtered].sort((left, right) => {
    const dateOrder = right.vod.date.localeCompare(left.vod.date);
    const idOrder = left.id.localeCompare(right.id);
    return filters.sort === "newest"
      ? dateOrder || idOrder
      : -dateOrder || idOrder;
  });
}

export function matchingVodPerformances(
  card: VodLibraryCard,
  queryValue: string,
): VodLibraryPerformance[] {
  const query = normalizeVodQuery(queryValue);
  if (!query || card.metadataSearchText.includes(query)) {
    return card.vod.performances;
  }
  return card.vod.performances.filter((performance) =>
    searchableText([performance.title, performance.originalArtist]).includes(
      query,
    ),
  );
}

export function performanceToDownloadPrefill(
  streamer: VodLibraryStreamer,
  vod: VodLibraryVod,
  performance: VodLibraryPerformance,
): DownloadPrefill {
  return {
    url: `https://www.youtube.com/watch?v=${vod.videoId}`,
    startSeconds: performance.startSeconds,
    endSeconds: performance.endSeconds,
    filenameMetadata: {
      streamer: streamer.displayName,
      songTitle: performance.title,
      artist: performance.originalArtist,
      vodTitle: vod.title,
      vodDate: vod.date,
    },
  };
}
