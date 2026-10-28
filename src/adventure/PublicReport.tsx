import { useEffect, useState } from "react";
import {
  getPublicReport,
  publicReportCsvUrl,
  type PublicReport,
  type PublicReportPeriod,
} from "@/services/publicReportApi";
import "./publicReport.css";

const numberFormat = new Intl.NumberFormat("vi-VN");
const percentFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const reportPeriods: PublicReportPeriod[] = [7, 30, 90];

function formatSeconds(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  if (minutes < 1) return `${numberFormat.format(Math.round(Math.max(0, seconds)))} giây`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${numberFormat.format(hours)} giờ ${numberFormat.format(remainder)} phút`;
  if (hours) return `${numberFormat.format(hours)} giờ`;
  return `${numberFormat.format(minutes)} phút`;
}

function formatPercent(value: number): string {
  return `${percentFormat.format(value)}%`;
}

export function setPublicReportIfCurrent(
  signal: AbortSignal,
  report: PublicReport,
  setReport: (report: PublicReport) => void,
) {
  if (!signal.aborted) setReport(report);
}

function trendPath(values: readonly (number | null)[], maximum: number, width: number, height: number, padding: number) {
  const safeMaximum = Number.isFinite(maximum) && maximum > 0 ? maximum : 1;
  const verticalRange = height - padding * 2;
  const horizontalRange = width - padding * 2;
  let hasPrevious = false;
  return values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      hasPrevious = false;
      return null;
    }
    const x = values.length <= 1 ? width / 2 : padding + (index / (values.length - 1)) * horizontalRange;
    const y = height - padding - (Math.max(0, Math.min(safeMaximum, value)) / safeMaximum) * verticalRange;
    const command = `${hasPrevious ? "L" : "M"}${x},${y}`;
    hasPrevious = true;
    return command;
  }).filter((command): command is string => command !== null).join(" ");
}

function DailyTrendChart({
  chartId,
  title,
  description,
  rows,
  value,
  maximum,
  formatValue = (item) => numberFormat.format(item),
}: {
  chartId: string;
  title: string;
  description: string;
  rows: PublicReport["daily"];
  value: (row: PublicReport["daily"][number]) => number | null;
  maximum?: number;
  formatValue?: (item: number) => string;
}) {
  const values = rows.map(value);
  const chartMaximum = maximum ?? Math.max(1, ...values.filter((item): item is number => item !== null));
  const width = 700;
  const height = 160;
  const padding = 16;
  const path = trendPath(values, chartMaximum, width, height, padding);
  const xFor = (index: number) => rows.length <= 1 ? width / 2 : padding + (index / (rows.length - 1)) * (width - padding * 2);
  const yFor = (item: number) => height - padding - (Math.max(0, Math.min(chartMaximum, item)) / chartMaximum) * (height - padding * 2);
  return <figure className="public-report__trend">
    <figcaption>
      <h3>{title}</h3>
      <p>{description}</p>
    </figcaption>
    <div className="public-report__chart-plot">
      <div className="public-report__chart-scale" aria-hidden="true">
        <span>{formatValue(chartMaximum)}</span><span>{formatValue(chartMaximum / 2)}</span><span>{formatValue(0)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${chartId}-title ${chartId}-description`} preserveAspectRatio="none">
        <title id={`${chartId}-title`}>{title}</title>
        <desc id={`${chartId}-description`}>{description} Trục dọc từ {formatValue(0)} đến {formatValue(chartMaximum)}. Mỗi điểm đại diện cho một ngày UTC, từ {rows[0]?.dateUtc ?? "không có dữ liệu"} đến {rows.at(-1)?.dateUtc ?? "không có dữ liệu"}.</desc>
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} className="public-report__chart-axis" />
        <line x1={padding} x2={width - padding} y1={height / 2} y2={height / 2} className="public-report__chart-gridline" />
        {path && <path d={path} className="public-report__chart-line" />}
        {values.map((item, index) => item === null ? null : <circle key={`${rows[index].dateUtc}-${index}`} cx={xFor(index)} cy={yFor(item)} r="2.6" className="public-report__chart-point"><title>{`${rows[index].dateUtc}: ${formatValue(item)}`}</title></circle>)}
      </svg>
    </div>
    <div className="public-report__chart-dates"><span>{rows[0]?.dateUtc ?? ""}</span><span>{rows.at(-1)?.dateUtc ?? ""}</span></div>
  </figure>;
}

export function PublicReportContent({
  report,
  days,
  loading,
  error,
  onRetry,
  onDaysChange,
}: {
  report: PublicReport | null;
  days: PublicReportPeriod;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onDaysChange: (days: PublicReportPeriod) => void;
}) {
  return <section className="public-report" aria-labelledby="public-report-title">
    <header className="public-report__header">
      <div>
        <p className="public-report__eyebrow">SỐ LIỆU HỌC TẬP</p>
        <h1 id="public-report-title">Báo cáo tổng hợp</h1>
        <p>Thống kê chung các chuyến học đã lưu và kết quả theo chủ đề.</p>
      </div>
      <div className="public-report__actions">
        <label className="public-report__period" htmlFor="public-report-period">
          Khoảng báo cáo
          <select id="public-report-period" value={days} onChange={(event) => onDaysChange(Number(event.target.value) as PublicReportPeriod)}>
            {reportPeriods.map((period) => <option value={period} key={period}>{period} ngày</option>)}
          </select>
        </label>
        <a className="public-report__export" href={publicReportCsvUrl(days)} download="viendu-public-report.csv">
          Tải CSV tổng hợp
        </a>
      </div>
    </header>

    <p className="public-report__privacy">
      Báo cáo chỉ hiển thị số liệu tổng hợp; không chứa thông tin tài khoản, mục tiêu cá nhân hay nội dung tài liệu. Xu hướng theo ngày dùng mốc UTC.
    </p>

    {loading && <p className="public-report__message" role="status">Đang tải báo cáo…</p>}
    {error && <div className="public-report__message public-report__message--error" role="alert">
      <p>{error}</p>
      <button type="button" onClick={onRetry}>Thử lại</button>
    </div>}

    {!loading && !error && report?.truncated && <p className="public-report__truncated" role="status">
      Đã phân tích {numberFormat.format(report.recordsAnalyzed)} trên {numberFormat.format(report.matchingSessionCount)} phiên khớp trong {report.days} ngày gần nhất. Giới hạn tối đa {numberFormat.format(report.analysisLimit)} phiên; các tổng, biểu đồ, bảng và CSV chỉ tính phần đã phân tích.
    </p>}

    {!loading && !error && report && <>
      {report.totals.sessionCount === 0 && <p className="public-report__message" role="status">Chưa có dữ liệu tổng hợp.</p>}
      <dl className="public-report__stats" aria-label="Số liệu tổng quan">
        <div><dt>Số chuyến học</dt><dd>{numberFormat.format(report.totals.sessionCount)}</dd></div>
        <div><dt>Thời gian học</dt><dd>{formatSeconds(report.totals.actualStudySeconds)}</dd></div>
        <div><dt>Thời gian tập trung</dt><dd>{formatSeconds(report.totals.focusedSeconds)}</dd></div>
        <div><dt>Đạt thời lượng mục tiêu</dt><dd>{formatPercent(report.totals.completionPercent)}</dd></div>
      </dl>

      <section className="public-report__daily" aria-labelledby="public-report-daily-title">
        <div className="public-report__section-heading">
          <div>
            <p className="public-report__eyebrow">{report.days} NGÀY GẦN NHẤT</p>
            <h2 id="public-report-daily-title">Xu hướng hàng ngày</h2>
          </div>
          <p>Ngày bắt đầu phiên và các mốc trên biểu đồ dùng UTC.</p>
        </div>
        <div className="public-report__chart-grid">
          <DailyTrendChart chartId="public-focus-trend" title="Thời gian tập trung" description="Tổng thời gian focus và học tài liệu đã lưu mỗi ngày." rows={report.daily} value={(row) => row.focusedSeconds} formatValue={formatSeconds} />
          <DailyTrendChart chartId="public-session-trend" title="Số chuyến mỗi ngày" description="Số phiên bắt đầu mỗi ngày UTC." rows={report.daily} value={(row) => row.sessionCount} />
          <DailyTrendChart chartId="public-completion-trend" title="Hoàn tất / phiên" description="Tỷ lệ phiên đạt mục tiêu trong tổng số phiên của ngày." rows={report.daily} value={(row) => row.sessionCount ? row.completionPercent : null} maximum={100} formatValue={formatPercent} />
          <DailyTrendChart chartId="public-quiz-coverage-trend" title="Độ phủ quiz theo ngày" description="Phiên có quiz đã chấm trên tổng số phiên của ngày." rows={report.daily} value={(row) => row.sessionCount ? row.quizCoveragePercent : null} maximum={100} formatValue={formatPercent} />
          <DailyTrendChart chartId="public-quiz-score-trend" title="Điểm quiz theo ngày" description="Điểm đạt trên tổng điểm ở các quiz đã chấm." rows={report.daily} value={(row) => row.quizScorePercent} maximum={100} formatValue={formatPercent} />
        </div>
        <div className="public-report__daily-table-wrap" role="region" aria-label="Bảng xu hướng hàng ngày UTC" tabIndex={0}>
          <table>
            <caption>Số liệu tổng hợp theo ngày UTC</caption>
            <thead><tr>
              <th scope="col">Ngày UTC</th>
              <th scope="col">Số chuyến</th>
              <th scope="col">Thời gian tập trung</th>
              <th scope="col">Hoàn tất / phiên</th>
              <th scope="col">Độ phủ quiz</th>
              <th scope="col">Điểm quiz</th>
            </tr></thead>
            <tbody>{report.daily.map((day) => <tr key={day.dateUtc}>
              <th scope="row"><time dateTime={day.dateUtc}>{day.dateUtc}</time></th>
              <td>{numberFormat.format(day.sessionCount)}</td>
              <td>{formatSeconds(day.focusedSeconds)}</td>
              <td>{day.sessionCount ? formatPercent(day.completionPercent) : "—"}</td>
              <td>{day.sessionCount ? formatPercent(day.quizCoveragePercent) : "—"}</td>
              <td>{day.quizScorePercent === null ? "—" : formatPercent(day.quizScorePercent)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="public-report__topics" aria-labelledby="public-report-topics-title">
        <div className="public-report__section-heading">
          <div>
            <p className="public-report__eyebrow">PHÂN BỐ</p>
            <h2 id="public-report-topics-title">Theo chủ đề</h2>
          </div>
          <p>Chủ đề không còn trong danh mục được gộp vào “Khác”.</p>
        </div>
        <div className="public-report__table-wrap">
          <table>
            <caption>Số chuyến, thời gian tập trung và tỷ lệ đạt mục tiêu theo chủ đề</caption>
            <thead><tr>
              <th scope="col">Chủ đề</th>
              <th scope="col">Số chuyến</th>
              <th scope="col">Thời gian tập trung</th>
              <th scope="col">Đạt mục tiêu</th>
            </tr></thead>
            <tbody>{report.topics.map((topic) => <tr key={topic.topic}>
              <th scope="row">{topic.topic}</th>
              <td>{numberFormat.format(topic.sessionCount)}</td>
              <td>{formatSeconds(topic.focusedSeconds)}</td>
              <td>{formatPercent(topic.completionPercent)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </>}
  </section>;
}

export function PublicReport() {
  const [report, setReport] = useState<PublicReport | null>(null);
  const [days, setDays] = useState<PublicReportPeriod>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getPublicReport(days, controller.signal).then((result) => {
      setPublicReportIfCurrent(controller.signal, result, setReport);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Không tải được báo cáo. Hãy thử lại sau.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [days, reload]);

  return <PublicReportContent
    report={report}
    days={days}
    loading={loading}
    error={error}
    onRetry={() => setReload((value) => value + 1)}
    onDaysChange={setDays}
  />;
}
