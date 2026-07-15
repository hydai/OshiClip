import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  Clock3,
  Database,
  Download,
  Library,
  LoaderCircle,
  Music2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  X,
} from "lucide-react";
import { VodStreamerAvatar } from "../components/VodStreamerAvatar";
import { formatDuration, formatTimecode } from "../lib/time";
import {
  filterVodLibraryCards,
  makeVodLibraryCards,
  matchingVodPerformances,
  performanceToDownloadPrefill,
  type VodLibrarySort,
} from "../lib/vodLibrary";
import type { DownloadPrefill, VodLibraryDataset } from "../types";

const PAGE_SIZE = 18;

interface VodLibraryViewProps {
  dataset: VodLibraryDataset | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  syncError: string | null;
  onSync: () => Promise<void>;
  onChoose: (prefill: DownloadPrefill) => void;
}

function publishedLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function dateLabel(value: string): string {
  return value.replaceAll("-", ".");
}

export function VodLibraryView({
  dataset,
  loading,
  syncing,
  error,
  syncError,
  onSync,
  onChoose,
}: VodLibraryViewProps) {
  const [query, setQuery] = useState("");
  const [streamerSlug, setStreamerSlug] = useState("");
  const [sort, setSort] = useState<VodLibrarySort>("newest");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setExpandedId(null);
  }, [query, streamerSlug, sort]);

  useEffect(() => {
    if (
      streamerSlug &&
      dataset &&
      !dataset.streamers.some((streamer) => streamer.slug === streamerSlug)
    ) {
      setStreamerSlug("");
    }
  }, [dataset, streamerSlug]);

  const cards = useMemo(
    () => (dataset ? makeVodLibraryCards(dataset) : []),
    [dataset],
  );
  const pickableStreamers = useMemo(
    () => dataset?.streamers.filter((streamer) => streamer.vods.length > 0) ?? [],
    [dataset],
  );
  const filteredCards = useMemo(
    () => filterVodLibraryCards(cards, { query, streamerSlug, sort }),
    [cards, query, sort, streamerSlug],
  );
  const visibleCards = filteredCards.slice(0, visibleCount);

  if (loading && !dataset) {
    return (
      <section className="library-view">
        <div className="library-state-card">
          <LoaderCircle className="spin" size={28} />
          <strong>正在載入本機歌回快取…</strong>
          <p>已有快取會立即顯示；第一次使用才需要下載並驗證目前的 VOD snapshot。</p>
        </div>
      </section>
    );
  }

  if (error || !dataset) {
    return (
      <section className="library-view">
        <div className="library-state-card error">
          <AlertCircle size={29} />
          <strong>目前無法載入歌回資料庫</strong>
          <p>{error ?? "沒有可用的資料。"}</p>
          <button
            className="button light"
            type="button"
            disabled={syncing}
            onClick={() => void onSync()}
          >
            <RefreshCw className={syncing ? "spin" : undefined} size={15} /> 再試一次
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="library-view">
      <div className="page-heading library-heading">
        <div>
          <p className="eyebrow"><Library size={14} /> VOD LIBRARY</p>
          <h1>從歌回裡，直接找到想收藏的歌。</h1>
          <p>搜尋 data.oshi.tw 的正式資料，選一首歌就能帶入下載片段。</p>
        </div>
        <div className="library-heading-mark" aria-hidden="true">
          <Database size={31} />
          <span><Music2 size={13} /></span>
        </div>
      </div>

      <div className="library-summary" role="group" aria-label="歌回資料庫摘要">
        <div>
          <span className="summary-icon violet"><Users size={18} /></span>
          <p><small>VTuber</small><strong>{dataset.counts.streamers.toLocaleString("zh-TW")}</strong></p>
        </div>
        <div>
          <span className="summary-icon mint"><Video size={18} /></span>
          <p><small>歌回 VOD</small><strong>{dataset.counts.vods.toLocaleString("zh-TW")}</strong></p>
        </div>
        <div>
          <span className="summary-icon coral"><Music2 size={18} /></span>
          <p><small>歌曲片段</small><strong>{dataset.counts.performances.toLocaleString("zh-TW")}</strong></p>
        </div>
        <div
          className={syncError ? "library-source warning" : "library-source"}
          title={syncError ? `同步失敗：${syncError}` : undefined}
          aria-live="polite"
        >
          <span>
            {syncError ? <AlertCircle size={16} /> : <ShieldCheck size={16} />}
            {dataset.sha256 === "preview"
              ? "預覽資料"
              : syncError
                ? "使用已驗證快取"
                : syncing
                  ? "正在背景同步"
                  : "SHA-256 已驗證"}
          </span>
          <small>上次同步 {publishedLabel(dataset.syncedAt)}</small>
          <small>資料發布 {publishedLabel(dataset.publishedAt)}</small>
        </div>
        <button
          type="button"
          className="button light library-refresh"
          aria-label="同步歌回資料庫"
          title={syncing ? "正在同步歌回資料庫" : "立即同步歌回資料庫"}
          disabled={syncing}
          onClick={() => void onSync()}
        >
          <RefreshCw className={syncing ? "spin" : undefined} size={16} />
          <span className="sr-only">同步歌回資料庫</span>
        </button>
      </div>

      <div className="library-toolbar">
        <div className="library-search">
          <Search size={18} />
          <label className="sr-only" htmlFor="vod-library-search">搜尋歌回資料庫</label>
          <input
            id="vod-library-search"
            type="search"
            value={query}
            placeholder="搜尋 VTuber、VOD、歌曲或原唱…"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label="清除搜尋" onClick={() => setQuery("")}>
              <X size={15} />
            </button>
          )}
        </div>
        <label className="library-select compact">
          <span>排序</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as VodLibrarySort)}>
            <option value="newest">最新優先</option>
            <option value="oldest">最舊優先</option>
          </select>
        </label>
      </div>

      <section className="library-talent-picker" aria-labelledby="library-talent-heading">
        <div className="library-talent-heading">
          <span>快速篩選</span>
          <strong id="library-talent-heading">選擇 VTuber</strong>
        </div>
        <div className="library-talent-rail">
          <button
            type="button"
            className={!streamerSlug ? "library-talent-chip active" : "library-talent-chip"}
            aria-pressed={!streamerSlug}
            onClick={() => setStreamerSlug("")}
          >
            <span className="all-streamers-mark" aria-hidden="true">
              <Sparkles size={18} />
            </span>
            <span>全部</span>
            <small>{cards.length.toLocaleString("zh-TW")} 場</small>
          </button>
          {pickableStreamers.map((streamer) => (
            <button
              type="button"
              className={streamerSlug === streamer.slug ? "library-talent-chip active" : "library-talent-chip"}
              aria-pressed={streamerSlug === streamer.slug}
              title={streamer.displayName}
              onClick={() => setStreamerSlug(streamer.slug)}
              key={streamer.slug}
            >
              <VodStreamerAvatar streamer={streamer} size="picker" />
              <span>{streamer.displayName}</span>
              <small>{streamer.vods.length.toLocaleString("zh-TW")} 場</small>
            </button>
          ))}
        </div>
      </section>

      <div className="library-results-heading">
        <p role="status">
          <strong>{filteredCards.length.toLocaleString("zh-TW")}</strong> 場符合條件的歌回
        </p>
        {(query || streamerSlug) && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setStreamerSlug("");
            }}
          >
            清除篩選
          </button>
        )}
      </div>

      {filteredCards.length === 0 ? (
        <div className="library-state-card compact">
          <Search size={27} />
          <strong>找不到符合條件的歌回</strong>
          <p>換個歌曲名稱、原唱或 VTuber 名稱再試一次。</p>
        </div>
      ) : (
        <div className="library-list" aria-busy={syncing}>
          {visibleCards.map((card) => {
            const expanded = card.id === expandedId;
            const matchingPerformances = matchingVodPerformances(card, query);
            const performances = expanded ? matchingPerformances : [];
            return (
              <article className={expanded ? "library-card expanded" : "library-card"} key={card.id}>
                <button
                  type="button"
                  className="library-card-toggle"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : card.id)}
                >
                  <VodStreamerAvatar streamer={card.streamer} />
                  <span className="library-card-copy">
                    <span className="library-card-meta">
                      <strong>{card.streamer.displayName}</strong>
                      <em>{card.streamer.group ?? "獨立創作者"}</em>
                      <span><CalendarDays size={12} /> {dateLabel(card.vod.date)}</span>
                    </span>
                    <span className="library-card-title">{card.vod.title}</span>
                    <small>
                      {matchingPerformances.slice(0, 3).map((performance) => performance.title).join(" · ")}
                    </small>
                  </span>
                  <span className="library-song-count">
                    <Music2 size={15} /> {card.vod.performances.length} 首
                  </span>
                  <ChevronDown className="library-chevron" size={18} />
                </button>

                {expanded && (
                  <div className="library-song-panel">
                    <div className="library-song-panel-heading">
                      <span>{query && performances.length !== card.vod.performances.length ? `符合搜尋的 ${performances.length} 首歌曲` : `完整時間軸 · ${performances.length} 首歌曲`}</span>
                      <small>選擇後只會帶入下載表單，不會自動開始下載。</small>
                    </div>
                    <div className="library-song-list">
                      {performances.map((performance) => (
                        <div className="library-song-row" key={performance.performanceId}>
                          <span className="library-song-index">
                            {String(card.vod.performances.indexOf(performance) + 1).padStart(2, "0")}
                          </span>
                          <span className="library-song-copy">
                            <strong>{performance.title}</strong>
                            <small>{performance.originalArtist ?? "原唱資料未提供"}</small>
                          </span>
                          <span className="library-song-time">
                            <span><Clock3 size={12} /> {formatTimecode(performance.startSeconds)}</span>
                            <small>{formatDuration(performance.endSeconds - performance.startSeconds)}</small>
                          </span>
                          <button
                            type="button"
                            className="button mint library-download-button"
                            onClick={() =>
                              onChoose(
                                performanceToDownloadPrefill(
                                  card.streamer,
                                  card.vod,
                                  performance,
                                ),
                              )
                            }
                          >
                            <Download size={14} /> 帶入下載
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {visibleCount < filteredCards.length && (
        <button
          type="button"
          className="button light library-more"
          onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
        >
          顯示更多歌回
          <ChevronDown size={15} />
        </button>
      )}
    </section>
  );
}
