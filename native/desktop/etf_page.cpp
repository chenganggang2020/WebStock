#include "etf_page.hpp"
#include <QCheckBox>
#include <QDesktopServices>
#include <QFile>
#include <QFileDialog>
#include <QHeaderView>
#include <QJsonDocument>
#include <QLabel>
#include <QListWidget>
#include <QNetworkReply>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSignalBlocker>
#include <QSplitter>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTableWidget>
#include "financial_delegate.hpp"
#include <QTimer>
#include <QUuid>
#include <QVBoxLayout>
#include <stdexcept>
namespace {
void require(bool ok, const char *message) {
  if (!ok)
    throw std::runtime_error(message);
}
QString local(const QJsonValue &value) {
  auto t = QDateTime::fromString(value.toString(), Qt::ISODateWithMs);
  return t.isValid() ? t.toOffsetFromUtc(28800).toString("yyyy-MM-dd HH:mm:ss")
                     : "未取得";
}
QJsonObject parsed(const QByteArray &bytes) {
  QJsonParseError e;
  auto d = QJsonDocument::fromJson(bytes, &e);
  require(e.error == QJsonParseError::NoError && d.isObject(),
          "JSON格式不可用");
  return d.object();
}
} // namespace
EtfPage::EtfPage(QString file, bool enabled, QWidget *parent)
    : QWidget(parent), store(file), networkEnabled(enabled) {
  setObjectName("etfPage");
  auto *root = new QVBoxLayout(this);
  auto *tools = new QHBoxLayout;
  root->addLayout(tools);
  auto button = [&](QString label, QString name, std::function<void()> action) {
    auto *b = new QPushButton(label, this);
    b->setObjectName(name);
    tools->addWidget(b);
    connect(b, &QPushButton::clicked, this, [this, action] {
      try {
        action();
      } catch (const std::exception &e) {
        state->setText("未执行：" + QString::fromUtf8(e.what()));
      }
    });
    return b;
  };
  button("重新载入", "etfRead", [this] { load(); });
  refresh = button("更新公开日报", "etfRefresh", [this] { refreshSource(); });
  refresh->setEnabled(enabled);
  stop = button("取消更新", "etfCancel", [this] {
    cancel();
    load();
  });
  stop->setEnabled(false);
  button("导入预览", "etfImport", [this] {
    auto file =
        QFileDialog::getOpenFileName(this, "只读选择旧ETF库或日报文件", {},
                                     "ETF资料 (*.json *.db *.sqlite)");
    if (!file.isEmpty())
      previewImport(file);
  });
  button("导出日报", "etfExport", [this] {
    auto file = QFileDialog::getSaveFileName(this, "保存为新文件",
                                             "ETF日报.json", "JSON (*.json)");
    if (!file.isEmpty())
      exportFile(file);
  });
  tools->addStretch();
  state = new QLabel;
  state->setObjectName("etfState");
  state->setWordWrap(true);
  state->setTextFormat(Qt::PlainText);
  root->addWidget(state);
  auto *scheduleRow = new QHBoxLayout;
  root->addLayout(scheduleRow);
  scheduleEnabled = new QCheckBox("自动检查ETF日报", this);
  scheduleEnabled->setObjectName("etfScheduleEnabled");
  scheduleRow->addWidget(scheduleEnabled);
  scheduleState = new QLabel;
  scheduleState->setObjectName("etfScheduleState");
  scheduleState->setWordWrap(true);
  scheduleState->setTextFormat(Qt::PlainText);
  scheduleRow->addWidget(scheduleState, 1);
  connect(scheduleEnabled, &QCheckBox::toggled, this, [this](bool enabled) {
    try {
      store.setScheduleEnabled(enabled);
      if (!enabled && scheduledRequest) cancel();
      load();
    } catch (const std::exception &e) {
      QSignalBlocker block(scheduleEnabled);
      scheduleEnabled->setChecked(!enabled);
      state->setText("计划未保存：" + QString::fromUtf8(e.what()));
    }
  });
  auto *split = new QSplitter(this);
  root->addWidget(split, 1);
  days = new QListWidget(split);
  days->setObjectName("etfHistory");
  days->setMinimumWidth(200);
  auto *content = new QWidget(split);
  auto *body = new QVBoxLayout(content);
  summary = new QLabel;
  summary->setObjectName("etfSummary");
  summary->setTextFormat(Qt::PlainText);
  summary->setWordWrap(true);
  body->addWidget(summary);
  dates = new QLabel;
  dates->setTextFormat(Qt::PlainText);
  dates->setWordWrap(true);
  body->addWidget(dates);
  auto *ranks = new QSplitter(Qt::Vertical, content);
  body->addWidget(ranks, 1);
  auto grid = [&](QString title, QString name) {
    auto *box = new QWidget(ranks);
    auto *layout = new QVBoxLayout(box);
    layout->addWidget(new QLabel(title));
    auto *t = new QTableWidget(0, 4, box);
    t->setObjectName(name);
    financialVisual::install(t,{3});
    t->setHorizontalHeaderLabels(
        {"排名", "ETF / 代码", "市场", "净额（亿元）"});
    t->setEditTriggers(QAbstractItemView::NoEditTriggers);
    t->setSelectionBehavior(QAbstractItemView::SelectRows);
    t->setSelectionMode(QAbstractItemView::SingleSelection);
    t->verticalHeader()->hide();
    t->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeToContents);
    t->horizontalHeader()->setSectionResizeMode(1, QHeaderView::Stretch);
    layout->addWidget(t);
    return t;
  };
  buys = grid("股票型ETF · 净申购前三", "etfSubscriptions");
  sells = grid("股票型ETF · 净赎回前三", "etfRedemptions");
  selected =
      new QLabel("双击ETF可在已有自选中打开；旧资料未记录市场时不猜测。");
  selected->setTextFormat(Qt::PlainText);
  selected->setWordWrap(true);
  body->addWidget(selected);
  auto *links = new QHBoxLayout;
  body->addLayout(links);
  article = new QPushButton("查看来源原文");
  image = new QPushButton("查看原图（非完整结构化榜）");
  links->addWidget(article);
  links->addWidget(image);
  auto openLink = [this](bool img) {
    auto url = report[img ? "originalImageUrl" : "sourceUrl"].toString();
    if (etfDaily::allowedUrl(url, img) && networkEnabled)
      QDesktopServices::openUrl(QUrl(url));
  };
  connect(article, &QPushButton::clicked, this,
          [openLink] { openLink(false); });
  connect(image, &QPushButton::clicked, this, [openLink] { openLink(true); });
  auto *note = new QLabel("ETF一级市场申购赎回 · 不是个股主力资金 / "
                          "二级市场成交额。正文仅两组前三；原图未结构化，不补造"
                          "全榜。来源公开可访问不代表取得行情再分发授权。");
  note->setWordWrap(true);
  body->addWidget(note);
  preview = new QPlainTextEdit;
  preview->setReadOnly(true);
  preview->setObjectName("etfPreview");
  preview->hide();
  root->addWidget(preview);
  importActions = new QWidget;
  auto *imports = new QHBoxLayout(importActions);
  imports->setContentsMargins(0, 0, 0, 0);
  root->addWidget(importActions);
  importActions->hide();
  confirm = new QPushButton("确认导入预览记录");
  confirm->setObjectName("etfConfirmImport");
  confirm->setEnabled(false);
  imports->addWidget(confirm);
  auto *discard = new QPushButton("取消导入预览");
  imports->addWidget(discard);
  connect(confirm, &QPushButton::clicked, this, [this] {
    try {
      confirmImport();
    } catch (const std::exception &e) {
      state->setText("未导入：" + QString::fromUtf8(e.what()));
    }
  });
  connect(discard, &QPushButton::clicked, this, [this] {
    pending = {};
    preview->clear();
    preview->hide();
    importActions->hide();
    confirm->setEnabled(false);
  });
  for (auto *t : {buys, sells})
    connect(t, &QTableWidget::cellDoubleClicked, this, [this, t](int row, int) {
      auto x = t->item(row, 1)->data(Qt::UserRole).toJsonObject();
      if (!x["market"].isString()) {
        selected->setText(
            "旧资料没有记录市场：仅展示原代码，不按前缀猜测跳转。");
        return;
      }
      emit quoteRequested(x["market"].toString() +
                          ":etf:" + x["code"].toString());
    });
  connect(days, &QListWidget::currentRowChanged, this, [this] { render(); });
  split->setSizes({250, 1100});
  load();
  auto *timer = new QTimer(this);
  timer->setObjectName("etfScheduleTimer");
  timer->setInterval(30000);
  connect(timer, &QTimer::timeout, this, &EtfPage::scheduleTick);
  timer->start();
  QTimer::singleShot(0, this, &EtfPage::scheduleTick);
}
EtfPage::~EtfPage() { cancel(); }
void EtfPage::load() {
  auto prior = report["articleId"].toString();
  try {
    records = store.history();
    QSignalBlocker b(days);
    days->clear();
    int selected = 0;
    for (auto v : records) {
      auto r = v.toObject()["report"].toObject();
      days->addItem(r["asOf"].toString() + " · " +
                    r["publishedAt"].toString().mid(11, 5));
      if (r["articleId"] == prior)
        selected = days->count() - 1;
    }
    days->setCurrentRow(days->count() ? selected : -1);
    b.unblock();
    render();
  } catch (const std::exception &e) {
    state->setText("本机记录读取失败：" + QString::fromUtf8(e.what()));
  }
}
void EtfPage::render() {
  report = {};
  buys->setRowCount(0);
  sells->setRowCount(0);
  summary->setText("暂无ETF日报，请点击更新或导入历史。");
  dates->clear();
  article->setEnabled(false);
  image->setEnabled(false);
  try {
    auto s = store.state();
    {
      QSignalBlocker block(scheduleEnabled);
      scheduleEnabled->setChecked(s["scheduleEnabled"].toBool(false));
    }
    scheduleState->setText(
        QString(s["scheduleEnabled"].toBool() ? "已启用" : "已关闭") +
        " · 应用运行时检查（关闭本子页仍执行）；北京时间已知交易日 "
        "08:50 / 09:00 / 09:10 / 09:20，晚启动当天补查一次。" +
        (s["lastScheduledAt"].isString()
             ? "\n最近计划尝试 " + local(s["lastScheduledAt"])
             : QString()));
    QString status = "最近尝试 " + local(s["lastAttemptAt"]) +
                     " · 最近内容更新 " + local(s["lastSuccessAt"]);
    if (s["attemptStatus"] == "running")
      status += " · 正在更新或上次运行中断；60秒后可重试";
    if (!s["lastError"].toString().isEmpty())
      status += "\n未更新，旧资料保留：" + s["lastError"].toString();
    state->setText(status);
    int n = days->currentRow();
    if (n < 0 || n >= records.size())
      return;
    auto entry = records[n].toObject();
    report = entry["report"].toObject();
    auto expected = etfDaily::previousDay(
        QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date());
    QString quality =
        entry["origin"] == "imported-cache" ? "导入历史 · 未经本次源核验"
        : expected.isValid() && report["asOf"] == expected.toString(Qt::ISODate)
            ? "覆盖上一已知交易日 · 非盘中实时"
            : "旧日报 / 日历未知 · 不代表当前";
    summary->setText(report["title"].toString() +
                     QString("\n全部ETF净额 %1  · 股票型ETF净额 %2  亿元")
                         .arg(report["totalNetFlow"].toDouble(), 0, 'f', 2)
                         .arg(report["stockEtfNetFlow"].toDouble(), 0, 'f', 2));
    dates->setText(quality + "\n数据日 " + report["asOf"].toString() +
                   " · 发布 " + local(report["publishedAt"]) + "\n本条核对 " +
                   local(entry["checkedAt"]) + " · 内容保存 " +
                   local(entry["succeededAt"]) +
                   (report["sourceNotice"].isString()
                        ? "\n" + report["sourceNotice"].toString()
                        : QString()));
    int k = 0;
    for (auto *t : {buys, sells}) {
      auto a = report[k++ == 0 ? "subscriptions" : "redemptions"].toArray();
      t->setRowCount(a.size());
      for (int i = 0; i < a.size(); i++) {
        auto r = a[i].toObject();
        QStringList values{QString::number(i + 1),
                           r["name"].toString() + " · " + r["code"].toString(),
                           r["market"].toString("未知"),
                           QString::number(r["value"].toDouble(), 'f', 2)};
        for (int j = 0; j < 4; j++) {
          auto *cell = new QTableWidgetItem(values[j]);
          cell->setData(Qt::UserRole, r);
          if (j == 3) {
            cell->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
            cell->setForeground(r["value"].toDouble() < 0
                                    ? QColor(21, 151, 127)
                                    : QColor(205, 56, 70));
          }
          t->setItem(i, j, cell);
        }
      }
    }
    article->setEnabled(true);
    image->setEnabled(report["originalImageUrl"].isString());
  } catch (const std::exception &e) {
    state->setText("无法展示：" + QString::fromUtf8(e.what()));
  }
}
void EtfPage::cancel() {
  ++generation;
  scheduledRequest = false;
  if (reply) {
    reply->abort();
    reply = nullptr;
  }
  if (!token.isEmpty()) {
    try {
      store.fail(token, "用户取消 / 页面关闭", QDateTime::currentDateTimeUtc());
    } catch (...) {
    }
    token.clear();
  }
  if (stop)
    stop->setEnabled(false);
  if (refresh)
    refresh->setEnabled(networkEnabled);
}
void EtfPage::fail(const QString &message) {
  if (!token.isEmpty()) {
    try {
      store.fail(token, message, QDateTime::currentDateTimeUtc());
    } catch (const std::exception &e) {
      token.clear();
      stop->setEnabled(false);
      refresh->setEnabled(networkEnabled);
      state->setText(message + "；状态保存失败：" +
                     QString::fromUtf8(e.what()));
      return;
    }
    token.clear();
  }
  stop->setEnabled(false);
  refresh->setEnabled(networkEnabled);
  load();
}
void EtfPage::request(const QString &url, int limit,
                      std::function<void(QByteArray)> complete) {
  require(etfDaily::allowedUrl(url), "禁止访问非固定日报源");
  QNetworkRequest request{QUrl(url)};
  request.setTransferTimeout(12000);
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                       QNetworkRequest::ManualRedirectPolicy);
  request.setRawHeader("User-Agent", "NativeMarketReview/0.25");
  auto *r = network.get(request);
  reply = r;
  auto data = std::make_shared<QByteArray>();
  auto oversize = std::make_shared<bool>(false);
  auto timed = std::make_shared<bool>(false);
  auto epoch = generation;
  auto *deadline = new QTimer(r);
  deadline->setSingleShot(true);
  connect(deadline, &QTimer::timeout, r, [r, timed] {
    *timed = true;
    r->abort();
  });
  deadline->start(12000);
  connect(r, &QIODevice::readyRead, this, [data, oversize, r, limit] {
    data->append(r->readAll());
    if (data->size() > limit) {
      *oversize = true;
      r->abort();
    }
  });
  connect(r, &QNetworkReply::finished, this,
          [this, r, data, oversize, timed, deadline, epoch, limit, complete] {
            deadline->stop();
            r->deleteLater();
            if (epoch != generation)
              return;
            reply = nullptr;
            try {
              data->append(r->readAll());
              require(!*oversize && data->size() <= limit, "公开源响应超限");
              require(!*timed, "公开源12秒超时");
              require(r->attribute(QNetworkRequest::HttpStatusCodeAttribute)
                                  .toInt() == 200 &&
                          r->error() == QNetworkReply::NoError,
                      "公开源未成功返回；保留缓存，未绕过访问限制");
              complete(*data);
            } catch (const std::exception &e) {
              fail(QString::fromUtf8(e.what()));
            }
          });
}
void EtfPage::refreshSource() {
  if (!networkEnabled || !token.isEmpty())
    return;
  try {
    token = store.begin(QDateTime::currentDateTimeUtc());
    scheduledRequest = false;
    startSource();
  } catch (const std::exception &e) {
    if (token.isEmpty())
      state->setText(QString::fromUtf8(e.what()));
    else
      fail(QString::fromUtf8(e.what()));
  }
}
void EtfPage::scheduleTick() {
  try {
    const auto now = QDateTime::currentDateTimeUtc();
    const auto due = scheduleClock.due(store.state(), now);
    if (!networkEnabled || !token.isEmpty() || due.isEmpty()) return;
    token = store.beginScheduled(scheduleClock, now);
    if (token.isEmpty()) return;
    scheduledRequest = true;
    startSource();
  } catch (const std::exception &e) {
    if (token.isEmpty())
      state->setText("自动检查未开始：" + QString::fromUtf8(e.what()));
    else
      fail(QString::fromUtf8(e.what()));
  }
}
void EtfPage::startSource() {
    ++generation;
    stop->setEnabled(true);
    refresh->setEnabled(false);
    state->setText("读取固定ETF栏目；两步校验通过才入库…");
    request(etfDaily::catalogUrl(QDateTime::currentMSecsSinceEpoch()),
            512 * 1024, [this](QByteArray data) {
              auto items = etfDaily::catalog(parsed(data));
              require(!items.isEmpty(), "栏目没有有效ETF追踪条目");
              auto item = items[0].toObject();
              request(etfDaily::contentUrl(item["code"].toString()),
                      3 * 1024 * 1024, [this, item](QByteArray data) {
                        auto now = QDateTime::currentDateTimeUtc();
                        auto result =
                            etfDaily::content(parsed(data), item, now);
                        require(store.finish(token, result, now),
                                "请求已过期或取消，未覆盖缓存");
                        token.clear();
                        stop->setEnabled(false);
                        refresh->setEnabled(networkEnabled);
                        report = result;
                        load();
                      });
            });
}
void EtfPage::previewImport(const QString &path) {
  pending = {};
  confirm->setEnabled(false);
  preview->clear();
  preview->hide();
  importActions->hide();
  QJsonArray incoming;
  if (path.endsWith(".db", Qt::CaseInsensitive) ||
      path.endsWith(".sqlite", Qt::CaseInsensitive)) {
    QString name = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", name);
      db.setDatabaseName(path);
      db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1500");
      QString error;
      try {
        require(db.open(), "旧数据库只读打开失败");
        QSqlQuery q(db);
        require(q.exec("SELECT payload_json FROM eastmoney_etf_daily_reports "
                       "ORDER BY as_of DESC LIMIT 501"),
                "旧库没有ETF日报表");
        int size = 0;
        while (q.next()) {
          auto bytes = q.value(0).toString().toUtf8();
          size += bytes.size();
          require(size <= 2 * 1024 * 1024 && incoming.size() < 500,
                  "旧ETF档案超过导入边界");
          incoming.append(etfDaily::validate(parsed(bytes)));
        }
      } catch (const std::exception &e) {
        error = QString::fromUtf8(e.what());
      }
      db.close();
      db = {};
      QSqlDatabase::removeDatabase(name);
      if (!error.isEmpty())
        throw std::runtime_error(error.toStdString());
    }
  } else {
    QFile f(path);
    require(f.open(QIODevice::ReadOnly) && f.size() <= 2 * 1024 * 1024,
            "文件不可读或超过2MiB");
    auto root = parsed(f.readAll());
    if (root["schema"] == "native-etf-archive-v1")
      incoming = root["reports"].toArray();
    else
      incoming.append(root);
  }
  require(!incoming.isEmpty() && incoming.size() <= 500, "没有可导入日报");
  QStringList lines;
  for (auto v : incoming) {
    auto r = etfDaily::validate(v.toObject());
    require(QDateTime::fromString(r["publishedAt"].toString(), Qt::ISODate) <=
                QDateTime::currentDateTimeUtc(),
            "导入发布时间在未来");
    lines << r["asOf"].toString() + " · " + r["title"].toString();
  }
  pending = incoming;
  preview->setPlainText(QString("待导入%"
                                "1份，尚未保存。作为历史资料导入，不升级为最新"
                                "；同ID冲突则整批取消。\n")
                            .arg(pending.size()) +
                        lines.join('\n'));
  preview->show();
  importActions->show();
  confirm->setEnabled(true);
  state->setText("预览完成：旧文件和旧库只读，确认后保存到原生独立库。");
}
void EtfPage::confirmImport() {
  require(!pending.isEmpty(), "没有有效预览");
  int n = store.importReports(pending, QDateTime::currentDateTimeUtc());
  pending = {};
  preview->hide();
  importActions->hide();
  confirm->setEnabled(false);
  load();
  state->setText(
      QString("已新增%1份历史日报，重复跳过；不是最新源核验。\n").arg(n) +
      state->text());
}
void EtfPage::exportFile(const QString &path) {
  require(path.endsWith(".json", Qt::CaseInsensitive), "只导出新JSON文件");
  QJsonArray data;
  for (auto v : store.history())
    data.append(v.toObject()["report"]);
  require(!data.isEmpty(), "没有可导出的日报");
  auto bytes = QJsonDocument(QJsonObject{{"schema", "native-etf-archive-v1"},
                                         {"reports", data}})
                   .toJson();
  QFile f(path);
  require(f.open(QIODevice::WriteOnly | QIODevice::NewOnly),
          "仅写新文件，不覆盖原档案或数据库");
  try {
    require(f.write(bytes) == bytes.size() && f.flush(), "导出写入失败");
  } catch (...) {
    f.close();
    f.remove();
    throw;
  }
  state->setText("导出完成；接收端按历史资料导入，不冒充实时。");
}
