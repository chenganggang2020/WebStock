#include "etf_daily.hpp"
#include <QRegularExpression>
#include <QSet>
#include <QUrl>
#include <QUrlQuery>
#include <QUuid>
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace etfDaily {
namespace {
void require(bool ok, const char *message) {
  if (!ok)
    throw std::runtime_error(message);
}
QRegularExpression re(const QString &s) {
  return QRegularExpression(s,
                            QRegularExpression::CaseInsensitiveOption |
                                QRegularExpression::DotMatchesEverythingOption);
}
QString clean(QString s) {
  s.remove(re("<script\\b.*?</script>|<style\\b.*?</style>"));
  s.replace(re("<[^>]+>"), " ");
  s.replace("&nbsp;", " ")
      .replace("&#160;", " ")
      .replace("&amp;", "&")
      .replace("&quot;", "\"")
      .replace("&#39;", "'");
  return s.simplified();
}
QDateTime publication(QString s) {
  if (!re("^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}$").match(s).hasMatch())
    return {};
  s[10] = 'T';
  auto d = QDateTime::fromString(s + "+08:00", Qt::ISODate);
  return d.isValid() &&
                 d.toOffsetFromUtc(28800).toString("yyyy-MM-dd'T'HH:mm:ss") == s
             ? d
             : QDateTime();
}
QDate dataDay(const QString &text, const QDate &publicationDay) {
  auto m = re("(\\d{1,2})月(\\d{1,2})日").match(text);
  require(m.hasMatch(), "日报缺少数据日期");
  int month = m.captured(1).toInt(), day = m.captured(2).toInt(),
      year = publicationDay.year();
  if (publicationDay.month() == 1 && month == 12)
    --year;
  QDate result(year, month, day);
  require(result.isValid() && result < publicationDay, "数据日期与发布日不符");
  return result;
}
double money(const QString &s, const QString &prefix) {
  auto m = re(prefix +
              "\\s*(净流入|净流出|净申购|净赎回)\\s*(\\d+(?:\\.\\d+)?)\\s*亿元")
               .match(s);
  require(m.hasMatch(), "核心申赎数字缺失，未补零");
  double v = m.captured(2).toDouble();
  require(std::isfinite(v) && v <= 1e12, "来源金额超限");
  return m.captured(1).contains("出") || m.captured(1).contains("赎回") ? -v
                                                                        : v;
}
QJsonArray ranking(const QString &body, const QString &label, int sign) {
  auto it = re("<p\\b[^>]*>(.*?)</p>").globalMatch(body);
  QString section;
  while (it.hasNext()) {
    auto s = it.next().captured(1);
    if (re("股票型ETF.*" + label + "前\\s*3").match(clean(s)).hasMatch()) {
      section = s;
      break;
    }
  }
  require(!section.isEmpty(), "股票型ETF前三正文缺失");
  auto rows =
      re("<a\\b[^>]*href=[\"']https://wap\\.eastmoney\\.com/quote/stock/"
         "([01])\\.(\\d{6})\\.html[\"'][^>]*>(.*?)</a>\\s*[，,]\\s*" +
         label + "\\s*(\\d+(?:\\.\\d+)?)\\s*亿元")
          .globalMatch(section);
  QJsonArray out;
  QSet<QString> codes;
  while (rows.hasNext()) {
    auto m = rows.next();
    QString code = m.captured(2), name = clean(m.captured(3));
    double value = m.captured(4).toDouble();
    require(!codes.contains(code) && !name.isEmpty() && name.size() <= 80 &&
                std::isfinite(value) && value <= 1e12,
            "前三身份/数值无效");
    codes.insert(code);
    out.append(QJsonObject{{"code", code},
                           {"market", m.captured(1) == "1" ? "SH" : "SZ"},
                           {"name", name},
                           {"value", sign * value},
                           {"unit", "亿元"}});
  }
  require(out.size() == 3, "前三成员不完整，未补造");
  return out;
}
} // namespace
QString catalogUrl(qint64 trace) {
  return "https://np-topic.eastmoney.com/v4/api/follow/single?trace=" +
         QString::number(trace) +
         "&client=wap&biz=sec_follow_detail&code=etfzz2026&count=10&timestamp="
         "0";
}
QString articleUrl(const QString &id) {
  require(re("^\\d{10,20}$").match(id).hasMatch(), "文章ID无效");
  return "https://wap.eastmoney.com/a/" + id + ".html";
}
QString contentUrl(const QString &id) {
  articleUrl(id);
  return "https://newsinfo.eastmoney.com/kuaixun/v2/api/content/"
         "getnews?newsid=" +
         id + "&newstype=1&guid=appzxzw" +
         QUuid::createUuid().toString(QUuid::WithoutBraces) +
         "&source=wap&version=1&language=&pkg=";
}
bool allowedUrl(const QString &s, bool image) {
  QUrl u(s, QUrl::StrictMode);
  if (!u.isValid() || u.scheme() != "https" || !u.userInfo().isEmpty() ||
      u.port() != -1 || u.hasFragment())
    return false;
  if (image)
    return u.host() == "np-newspic.dfcfw.com" && !u.hasQuery() &&
           re("^/download/[A-Za-z0-9_-]+\\.(jpg|jpeg|png|webp)$")
               .match(u.path())
               .hasMatch();
  if (u.host() == "wap.eastmoney.com")
    return !u.hasQuery() &&
           re("^/a/\\d{10,20}\\.html$").match(u.path()).hasMatch();
  if (u.host() == "newsinfo.eastmoney.com") {
    QUrlQuery q(u);
    return u.path() == "/kuaixun/v2/api/content/getnews" &&
           q.queryItems().size() == 7 &&
           re("^\\d{10,20}$").match(q.queryItemValue("newsid")).hasMatch() &&
           q.queryItemValue("newstype") == "1" &&
           re("^appzxzw[0-9a-f-]{36}$")
               .match(q.queryItemValue("guid"))
               .hasMatch() &&
           q.queryItemValue("source") == "wap" &&
           q.queryItemValue("version") == "1" && q.hasQueryItem("language") &&
           q.queryItemValue("language").isEmpty() && q.hasQueryItem("pkg") &&
           q.queryItemValue("pkg").isEmpty();
  }
  if (u.host() != "np-topic.eastmoney.com" ||
      u.path() != "/v4/api/follow/single")
    return false;
  QUrlQuery q(u);
  return q.queryItems().size() == 6 &&
         re("^\\d+$").match(q.queryItemValue("trace")).hasMatch() &&
         q.queryItemValue("client") == "wap" &&
         q.queryItemValue("biz") == "sec_follow_detail" &&
         q.queryItemValue("code") == "etfzz2026" &&
         q.queryItemValue("count") == "10" &&
         q.queryItemValue("timestamp") == "0";
}
bool knownOpen(QDate d) {
  if (!d.isValid() || d.year() != 2026 || d.dayOfWeek() > 5)
    return false;
  QString s = d.toString("MM-dd");
  for (auto p :
       QStringList{"01-01/01-03", "02-15/02-23", "04-04/04-06", "05-01/05-05",
                   "06-19/06-21", "09-25/09-27", "10-01/10-07"}) {
    auto a = p.split('/');
    if (s >= a[0] && s <= a[1])
      return false;
  }
  return true;
}
QDate previousDay(QDate d) {
  if (!d.isValid() || d.year() != 2026)
    return {};
  for (int i = 0; i < 40; ++i) {
    d = d.addDays(-1);
    if (d.year() != 2026)
      return {};
    if (knownOpen(d))
      return d;
  }
  return {};
}
QJsonArray catalog(const QJsonObject &input) {
  const QJsonValue elements = input["data"].toObject()["elements"];
  require(input["success"].isDouble() && input["success"].toDouble() == 1 &&
              elements.isArray(),
          "东方财富栏目格式不可用");
  QList<QJsonObject> items;
  int n = 0;
  for (auto value : elements.toArray()) {
    if (++n > 20)
      break;
    auto e = value.toObject();
    if (e["type"].toString() != "NewsList")
      continue;
    int count = 0;
    for (auto item : e["data"].toArray()) {
      if (++count > 10)
        break;
      auto r = item.toObject();
      if (re("^\\d{10,20}$").match(r["code"].toString()).hasMatch() &&
          r["title"].toString().contains("ETF追踪") &&
          publication(r["stime"].toString()).isValid())
        items.append(r);
    }
  }
  std::stable_sort(items.begin(), items.end(),
                   [](const QJsonObject &a, const QJsonObject &b) {
                     return publication(a["stime"].toString()) >
                            publication(b["stime"].toString());
                   });
  QJsonArray out;
  for (int i = 0; i < std::min(10, int(items.size())); ++i)
    out.append(items[i]);
  return out;
}
static QJsonObject parseBody(QString body, const QJsonObject &item,
                             const QDateTime &published, const QDateTime &now) {
  require(body.toUtf8().size() <= 3 * 1024 * 1024 && now.isValid(),
          "正文大小或读取时刻无效");
  body.remove(re("<script\\b.*?</script>|<style\\b.*?</style>"));
  QString text = clean(body);
  require(published.isValid() && published <= now,
          "发布时间缺失、无效或在未来");
  QString title = clean(item["title"].toString());
  require(title.contains("ETF追踪"), "不是ETF追踪日报");
  QString summaryText;
  auto paragraphs = re("<p\\b[^>]*>(.*?)</p>").globalMatch(body);
  while (paragraphs.hasNext()) {
    auto p = clean(paragraphs.next().captured(1));
    if (p.contains("ETF资金整体")) {
      require(summaryText.isEmpty(), "多段资金摘要冲突");
      summaryText = p;
    }
  }
  require(!summaryText.isEmpty(), "资金摘要段落缺失");
  QDate asOf = dataDay(summaryText, published.date());
  require(dataDay(title, published.date()) == asOf, "标题和正文数据日不一致");
  auto previous = previousDay(published.date());
  require(!previous.isValid() || previous == asOf, "不是发布日前一交易日");
  QJsonValue image;
  auto images = re("<img\\b[^>]*\\bsrc=[\"']([^\"']+)[\"']").globalMatch(body);
  while (images.hasNext()) {
    auto url = images.next().captured(1);
    if (allowedUrl(url, true)) {
      image = url;
      break;
    }
  }
  QJsonObject r{
      {"schema", "webstock.eastmoney-etf-daily.v1"},
      {"articleId", item["code"].toString()},
      {"title", title},
      {"provider", "eastmoney-choice-public-article"},
      {"source", "东方财富Choice数据 · 公开日报"},
      {"sourceUrl", articleUrl(item["code"].toString())},
      {"originalImageUrl", image},
      {"publishedAt", published.toOffsetFromUtc(28800).toString(Qt::ISODate)},
      {"asOf", asOf.toString(Qt::ISODate)},
      {"unit", "亿元"},
      {"totalNetFlow", money(summaryText, "ETF资金整体")},
      {"stockEtfNetFlow", money(summaryText, "股票型(?:ETF)?")},
      {"subscriptions", ranking(body, "净申购", 1)},
      {"redemptions", ranking(body, "净赎回", -1)},
      {"coverage",
       QJsonObject{{"body", "TOP3"},
                   {"image", image.isString()
                                 ? QJsonValue("原文图表（未结构化提取）")
                                 : QJsonValue()}}},
      {"methodology", "东方财富Choice公开发布的ETF日度净申购赎回数据；未取得其"
                      "逐只基金计算明细，未独立复算。"},
      {"truthStatement",
       "ETF一级市场申购赎回口径，不是全A主力资金，也不是二级市场成交额。"}};
  if (text.contains("本文基于AI生产"))
    r["sourceNotice"] =
        "原文标注：本文基于AI生产，仅供参考；数据未经本软件独立复算。";
  return validate(r);
}
QJsonObject article(const QString &html, const QJsonObject &item,
                    const QDateTime &now) {
  require(html.toUtf8().size() <= 3 * 1024 * 1024, "正文过大");
  auto start =
      re("<div\\b[^>]*\\bid=[\"']articleContent[\"'][^>]*>").match(html);
  require(start.hasMatch(), "日报正文区不可用");
  QString tail = html.mid(start.capturedEnd());
  auto end = re("<div\\b[^>]*\\bclass=[\"'][^\"']*\\bend_source\\b[^\"']*[\"']["
                "^>]*>(.*?)</div>")
                 .match(tail);
  require(end.hasMatch(), "正文来源区缺失");
  require(item["source"].toString().trimmed() == "东方财富Choice数据" &&
              re("^文章来源[：:]\\s*东方财富Choice数据$")
                  .match(clean(end.captured(1)))
                  .hasMatch(),
          "目录和正文来源缺失或冲突");
  auto time = re("data-showtime\\s*=\\s*[\"']([^\"']+)").match(html);
  auto r = parseBody(tail.left(end.capturedStart()), item,
                     publication(time.hasMatch() ? time.captured(1)
                                                 : item["stime"].toString()),
                     now);
  r["sourceVerification"] = "catalog+article-footer";
  return r;
}
QJsonObject content(const QJsonObject &payload, const QJsonObject &item,
                    const QDateTime &now) {
  require(payload["rc"].isDouble() && payload["rc"].toDouble() == 1 &&
              payload["news"].isObject(),
          "官方正文接口未返回文章");
  auto n = payload["news"].toObject();
  require(
      n["blockClients"].isString() && n["blockClients"].toString().isEmpty() &&
          (n["aiCont"].isNull() || n["aiCont"].isUndefined()) &&
          (n["aiContUrl"].isNull() || n["aiContUrl"].isUndefined() ||
           (n["aiContUrl"].isString() && n["aiContUrl"].toString().isEmpty())),
      "正文受限或类型改变，未绕过或跳转");
  require(n["newsid"].isString() && n["newsid"] == item["code"] &&
              n["title"].isString() &&
              clean(n["title"].toString()) == clean(item["title"].toString()),
          "目录与正文身份不一致");
  require(n["source"].toString().trimmed() == "东方财富Choice数据" &&
              item["source"].toString().trimmed() == "东方财富Choice数据",
          "目录与官方正文来源冲突");
  auto published = publication(n["showtime"].toString());
  require(published.isValid() &&
              published == publication(item["stime"].toString()),
          "目录与正文发布时间不一致");
  auto r = parseBody(n["body"].toString(), item, published, now);
  // The site's public script inserts these image markers. Never execute its
  // script or follow redirect/ad URLs.
  auto markers = re("<!--IMG#(\\d+)-->").globalMatch(n["body"].toString());
  auto images = n["images"].toArray();
  while (markers.hasNext()) {
    bool ok = false;
    int i = markers.next().captured(1).toInt(&ok);
    if (!ok || i < 0 || i >= images.size())
      continue;
    auto entry = images[i].toObject();
    if (!entry["class"].toString().isEmpty() ||
        !allowedUrl(entry["src"].toString(), true))
      continue;
    r["originalImageUrl"] = entry["src"];
    auto coverage = r["coverage"].toObject();
    coverage["image"] = "原文图表（未结构化提取）";
    r["coverage"] = coverage;
    break;
  }
  r["sourceVerification"] = "catalog+official-content-api";
  return validate(r);
}
QJsonObject validate(const QJsonObject &r) {
  require(r["schema"] == "webstock.eastmoney-etf-daily.v1" &&
              r["provider"] == "eastmoney-choice-public-article" &&
              r["source"] == "东方财富Choice数据 · 公开日报" &&
              r["unit"] == "亿元" &&
              r["sourceUrl"].toString() ==
                  articleUrl(r["articleId"].toString()),
          "缓存来源或口径无效");
  QString pub = r["publishedAt"].toString(), date = r["asOf"].toString(),
          title = r["title"].toString();
  require(pub.size() == 25 && pub.endsWith("+08:00"), "缓存发布时区无效");
  auto at = publication(pub.left(19));
  QDate d = QDate::fromString(date, Qt::ISODate);
  require(at.isValid() && d.isValid() && d.toString(Qt::ISODate) == date &&
              title.contains("ETF追踪") && title.size() <= 500 &&
              dataDay(title, at.date()) == d,
          "缓存数据日期/标题无效");
  auto previous = previousDay(at.date());
  require(!previous.isValid() || previous == d, "缓存交易日不一致");
  for (auto key : {"totalNetFlow", "stockEtfNetFlow"})
    require(r[key].isDouble() && std::isfinite(r[key].toDouble()) &&
                std::abs(r[key].toDouble()) <= 1e12,
            "缓存金额缺失或无效");
  auto image = r["originalImageUrl"];
  require(image.isNull() ||
              (image.isString() && allowedUrl(image.toString(), true)),
          "缓存原图链接不安全");
  require(r["coverage"].toObject()["body"] == "TOP3", "只能结构化正文前三");
  for (auto key : {"subscriptions", "redemptions"}) {
    auto a = r[key].toArray();
    require(a.size() == 3, "缓存前三不完整");
    QSet<QString> codes;
    for (auto value : a) {
      auto x = value.toObject();
      QString code = x["code"].toString(), name = x["name"].toString(),
              market = x.value("market").toString();
      double amount = x["value"].toDouble();
      require(re("^\\d{6}$").match(code).hasMatch() && !codes.contains(code) &&
                  !name.trimmed().isEmpty() && name.size() <= 80 &&
                  x["unit"] == "亿元" && x["value"].isDouble() &&
                  std::isfinite(amount) && std::abs(amount) <= 1e12 &&
                  (QString(key) == "subscriptions" ? amount >= 0 : amount <= 0),
              "缓存前三身份/金额无效");
      require(!x.contains("market") || market == "SH" || market == "SZ",
              "缓存市场无效");
      codes.insert(code);
    }
  }
  return r;
}
} // namespace etfDaily
