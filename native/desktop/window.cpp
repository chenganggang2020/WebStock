#include "window.hpp"
#include "capital_timeline.hpp"
#include "capital_workbench_roster.hpp"
#include "public_market_runtime.hpp"
#include "detail_disclosure.hpp"
#include "board_series_widget.hpp"
#include "compact_actions.hpp"
#include "current_workspace_tabs.hpp"
#include "visible_refresh.hpp"
#include <QCloseEvent>
#include "appearance.hpp"
#include "financial_delegate.hpp"
#include "capital_archive_reader.hpp"
#include "business_source_versions.hpp"
#include "page_snapshot_reader.hpp"
#include "backup_scope_snapshot.hpp"
#include "public_price_detail_page.hpp"
#include "legacy_highfreq.hpp"
#include "legacy_highfreq_page.hpp"
#include "market_comparison_page.hpp"
#include "global_market_page.hpp"
#include "sector_watch_store.hpp"
#include "legacy_archive_page.hpp"
#include "research_workbench_page.hpp"
#include "research_workbench_host.hpp"
#include "research_model_sources.hpp"
#include "local_candidate_store.hpp"
#include "news_store.hpp"
#include "creator_page.hpp"
#include "paper_monitor_host_page.hpp"
#include "paper_monitor_native_host.hpp"
#include "unified_backup_host_page.hpp"
#include <QPlainTextEdit>
#include "archive_video_review_page.hpp"
#include "auction_analysis_page.hpp"
#include "auction_history_source.hpp"
#include "watchlist_host_adapter.hpp"
#include "etf_monitor_page.hpp"
#include "futures_monitor_page.hpp"
#include "cffex_disclosure_page.hpp"
#include "account_edit_page.hpp"
#include "watchlist_workspace_page.hpp"
#include "watchlist_reconciliation_page.hpp"
#include <QThread>
#include <QCryptographicHash>
#include "material_library_page.hpp"
#include "knowledge_ai_host_page.hpp"
#include "knowledge_legacy.hpp"
#include "ai_settings_store.hpp"
#include "data_source_status_page.hpp"
#include "data_source_snapshot_adapter.hpp"
#include <QScopedValueRollback>
#include "migration_status_page.hpp"
#include "migration_status_model.hpp"
#include "ai_settings_page.hpp"
#include "portfolio_mirror_page.hpp"
#include "industry_topic_page.hpp"
#include "industry_page.hpp"
#include "business_restore_store.hpp"
#include "collection_pipeline.hpp"

#include <QApplication>
#include <QCheckBox>
#include <QColorDialog>
#include <QComboBox>
#include <QCoreApplication>
#include <QDialog>
#include <QDialogButtonBox>
#include <QDir>
#include <QDesktopServices>
#include <QFile>
#include <QFileDialog>
#include <QFormLayout>
#include <QHeaderView>
#include <QInputDialog>
#include <QJsonDocument>
#include <QJsonObject>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QAbstractSpinBox>
#include <QMenu>
#include <QMessageBox>
#include <QPainter>
#include <QPainterPath>
#include <QRegularExpression>
#include <QSaveFile>
#include <QScrollArea>
#include <QShortcut>
#include <QSignalBlocker>
#include <QSlider>
#include <QSpinBox>
#include <QStandardPaths>
#include "rotation_page.hpp"
#include "etf_page.hpp"
#include "dark_stock_page.hpp"
#include "recent_page.hpp"
#include "local_candidate_page.hpp"
#include "window_local_candidate_background.hpp"
#include "sector_watch_page.hpp"
#include "sector_leader_page.hpp"
#include "scenario_tools_page.hpp"
#include "source_analysis_page.hpp"
#include "source_handoff_page.hpp"
#include "research_runs_page.hpp"
#include "stock_research_page.hpp"
#include "securities_legacy_store.hpp"
#include "research_context.hpp"
#include "comment_workshop_page.hpp"
#include "news_page.hpp"
#include "person_method_page.hpp"
#include "evidence_review_page.hpp"
#include "risk_settings_page.hpp"
#include "data_safety_page.hpp"
#include "data_safety_store.hpp"
#include "market_overview_page.hpp"
#include "market_overview_model.hpp"
#include "industry_discovery_page.hpp"
#include "industry_discovery_store.hpp"
#include "quant_research_page.hpp"
#include "sector_research_page.hpp"
#include "sector_leader_store.hpp"
#include <QStatusBar>
#include <QStyledItemDelegate>
#include <QTabBar>
#include <QTimer>
#include <QVBoxLayout>

#include "business_pages.hpp"
#include "account_analysis_page.hpp"
#include "ui_mainwindow.h"
namespace {
QColor quoteForeground(const appearance::Theme& theme, double change) {
  return !std::isfinite(change) || change == 0 ? theme.muted
                                            : change > 0 ? theme.up : theme.down;
}
// Row selection is structural; it must not replace the quote's red/green
// meaning.
class QuoteDelegate : public QStyledItemDelegate {
 public:
  using QStyledItemDelegate::QStyledItemDelegate;
  void paint(QPainter* p, const QStyleOptionViewItem& o,
             const QModelIndex& i) const override {
    QStyleOptionViewItem option(o);
    initStyleOption(&option, i);
    const QString text = option.text;
    option.text.clear();
    auto* style = o.widget ? o.widget->style() : QApplication::style();
    style->drawControl(QStyle::CE_ItemViewItem, &option, p, o.widget);
    p->save();
    p->setFont(option.font);
    const QVariant foreground = i.data(Qt::ForegroundRole);
    p->setPen(foreground.isValid() ? foreground.value<QBrush>().color()
                                   : o.palette.color(QPalette::Text));
    const QRect area = o.rect.adjusted(6, 0, -6, 0);
    p->drawText(area, option.displayAlignment,
                QFontMetrics(option.font)
                    .elidedText(text, Qt::ElideRight, area.width()));
    p->restore();
  }
};
class NameDelegate : public QStyledItemDelegate {
 public:
  using QStyledItemDelegate::QStyledItemDelegate;
  void paint(QPainter* p, const QStyleOptionViewItem& o,
             const QModelIndex& i) const override {
    QStyleOptionViewItem option(o);
    initStyleOption(&option, i);
    option.text.clear();
    auto* style = o.widget ? o.widget->style() : QApplication::style();
    style->drawControl(QStyle::CE_ItemViewItem, &option, p, o.widget);
    p->save();
    QStringList lines = i.data().toString().split('\n');
    QFont name = o.font;
    name.setPixelSize(13);
    name.setWeight(QFont::DemiBold);
    p->setFont(name);
    p->setPen(o.palette.color(QPalette::Text));
    QRect area = o.rect.adjusted(8, 1, -6, -1);
    p->drawText(QRect(area.left(), area.top(), area.width(), 15),
                Qt::AlignLeft | Qt::AlignVCenter,
                QFontMetrics(name).elidedText(lines.value(0), Qt::ElideRight,
                                              area.width()));
    QFont code = o.font;
    code.setPixelSize(10);
    p->setFont(code);
    const auto theme = appearance::theme(
        o.widget ? o.widget->window()->property("stockTheme").toString() : QString{});
    p->setPen(theme.muted);
    p->drawText(QRect(area.left(), area.top() + 15, area.width(), 11),
                Qt::AlignLeft | Qt::AlignVCenter, lines.value(1));
    p->restore();
  }
};
class NumericItem : public QTableWidgetItem {
 public:
  NumericItem(const QString& text, double value) : QTableWidgetItem(text) {
    setData(Qt::UserRole + 1, value);
  }
  bool operator<(const QTableWidgetItem& other) const override {
    return data(Qt::UserRole + 1).toDouble() <
           other.data(Qt::UserRole + 1).toDouble();
  }
};
class SparkDelegate : public QStyledItemDelegate {
 public:
  using QStyledItemDelegate::QStyledItemDelegate;
  void paint(QPainter* p, const QStyleOptionViewItem& o,
             const QModelIndex& i) const override {
    QStyledItemDelegate::paint(p, o, i);
    auto values = i.data(Qt::UserRole).toList();
    if (values.size() < 2) {
      p->save();
      const auto theme = appearance::theme(
          o.widget ? o.widget->window()->property("stockTheme").toString() : QString{});
      p->setPen(theme.muted);
      p->drawText(o.rect, Qt::AlignCenter, "未加载");
      p->restore();
      return;
    }
    double lo = INFINITY, hi = -INFINITY;
    for (auto value : values) {
      lo = std::min(lo, value.toDouble());
      hi = std::max(hi, value.toDouble());
    }
    QRectF r = o.rect.adjusted(10, 8, -10, -8);
    QPainterPath path;
    for (int n = 0; n < values.size(); ++n) {
      QPointF point(r.left() + r.width() * n / (values.size() - 1),
                    r.bottom() - (values[n].toDouble() - lo) /
                                     std::max(1e-9, hi - lo) * r.height());
      if (n == 0)
        path.moveTo(point);
      else
        path.lineTo(point);
    }
    p->save();
    p->setRenderHint(QPainter::Antialiasing);
    p->setPen(QPen(i.data(Qt::ForegroundRole).value<QBrush>().color(), 1.25));
    p->drawPath(path);
    p->restore();
  }
};
int pricePrecision(const QJsonObject& instrument) {
  return instrument["id"].toString().contains(":etf:", Qt::CaseInsensitive) ? 3
                                                                            : 2;
}
QJsonObject displayedQuote(const QJsonObject& s, bool testing) {
  if (!testing) return s["quote"].toObject();
  auto a = s["day"].toArray();
  if (a.size() < 2) return {};
  auto last = a.last().toObject();
  double prev = a[a.size() - 2].toObject()["close"].toDouble();
  last["price"] = last["close"];
  last["previousClose"] = prev;
  last["changePercent"] = (last["price"].toDouble() / prev - 1) * 100;
  return last;
}
QString shortValue(double n, int decimals = 2) {
  return std::isfinite(n) ? QString::number(n, 'f', decimals) : QString("—");
}
QString quoteSummaryHtml(const QJsonObject& instrument, const QJsonObject& last,
                         bool testing, const appearance::Theme& theme) {
  const double price = marketdata::value(last, "price"),
               pct = marketdata::value(last, "changePercent");
  return QString("<b style='font-size:16px'>%1</b>  <span "
                 "style='color:%7'>%2</span>  <span "
                 "style='font-size:24px;font-family:Consolas;color:%3'>%4</"
                 "span>  <span "
                 "style='font-size:22px;font-family:Consolas;color:%3'>%5%</span>  <span "
                 "style='color:%7'>%6</span>")
      .arg(instrument["name"].toString().toHtmlEscaped(),
           instrument["market"].toString().toHtmlEscaped(),
           quoteForeground(theme, pct).name(),
           shortValue(price, pricePrecision(instrument)), shortValue(pct, 2),
           testing ? "模拟 · 形成中"
                   : (last["tradeDate"].toString() + " " +
                      last["tradeTime"].toString() +
                      (last["cached"].toBool() ? " 旧缓存" : ""))
                         .toHtmlEscaped(),
           theme.muted.name());
}
QString selectedQuoteHtml(const QJsonObject& instrument,const Chart* source,int index,bool testing,const appearance::Theme& theme){
  if(!source||index<0||index>=int(source->bars.size()))return quoteSummaryHtml(instrument,displayedQuote(instrument,testing),testing,theme);
  const auto& bar=source->bars[index];const double base=source->minute?source->previousClose:index>0&&market::valid(source->bars[index-1])?source->bars[index-1].close:NAN;
  const bool valid=market::valid(bar);
  QJsonObject selected{{"price",valid?QJsonValue(bar.close):QJsonValue(QJsonValue::Null)},
    {"changePercent",valid&&std::isfinite(base)&&base>0?QJsonValue((bar.close/base-1)*100):QJsonValue(QJsonValue::Null)},
    {"tradeDate",source->labels.value(index)},{"tradeTime",QString("选中 · ")+(source->minute?"较昨收":"较前一根收盘")+(testing?" · 模拟":"")}};
  return quoteSummaryHtml(instrument,selected,false,theme);
}
QString dataLabel(const QJsonObject& s, const QString& period) {
  auto q = s["quote"].toObject(), meta = s[period + "Meta"].toObject();
  QString state = q["tradeDate"].toString() + " " + q["tradeTime"].toString();
  if (state.trimmed().isEmpty())
    state = "报价待加载";
  else if (q["cached"].toBool())
    state += " · 旧缓存";
  if (!meta.isEmpty())
    state += " | " + meta["source"].toString() + " " +
             meta["dataDate"].toString() +
             (meta["adjustment"] == "qfq" ? " 前复权" : " 不复权") +
             (meta["cached"].toBool() ? " · 历史数据" : "");
  if (!meta["error"].toString().isEmpty())
    state += " | " + meta["error"].toString();
  if (meta["offSessionCount"].toInt() > 0)
    state += QString(" | 常规分时不含 %1 个盘外点")
                 .arg(meta["offSessionCount"].toInt());
  if (!q["error"].toString().isEmpty()) state += " | " + q["error"].toString();
  if (period.startsWith("minute") && period != "minute")
    state += " | " + s["samplingStatus"].toString();
  const QString disk = meta["persistenceState"].toString();
  if (disk == "saved")
    state += " | 已保存 " +
             QDateTime::fromString(meta["persistedAt"].toString(), Qt::ISODate)
                 .toLocalTime()
                 .toString("HH:mm:ss");
  else if (disk == "pending")
    state += " | 已取得 · 保存中";
  else if (disk == "failed")
    state += " | 更新未保存 · 保留已有数据";
  if (q["persistenceState"] == "failed") state += " | 报价未保存";
  if (!meta["historyBoundary"].toString().isEmpty())
    state += " | " + meta["historyBoundary"].toString();
  return state;
}
}  // namespace
static QString number(double v, int precision = 3) {
  return std::isfinite(v) ? QString::number(v, 'f', precision)
                          : QString("—（样本不足/缺失）");
}
static QString eventLabel(const std::string& event) {
  static const QMap<QString, QString> labels{
      {"price-flip", "严格价格翻转"},
      {"setup-complete", "准备序列达到9"},
      {"setup-perfected", "准备序列完善条件满足"},
      {"countdown-complete", "倒计数达到13"},
      {"tdst-breached:resistance", "阻力被突破，失效"},
      {"tdst-breached:support", "支撑被突破，失效"},
      {"countdown-cancelled:data-gap", "数据缺口，倒计数取消"},
      {"countdown-cancelled:tdst-breach", "TDST越界，倒计数取消"},
      {"countdown-cancelled:opposite-setup", "反向准备9完成，倒计数取消"},
      {"countdown-recycled:setup-range", "同向范围满足条件，倒计数重新开始"},
      {"countdown-recycled:setup-22", "同向准备达到22，倒计数重新开始"}};
  QString key = QString::fromStdString(event);
  return labels.value(key, key);
}
QPushButton* Window::button(const QString& text, const QString& id,
                            QWidget* p) {
  auto* b = new QPushButton(text, p);
  b->setObjectName(id);
  b->setMinimumHeight(26);
  b->setCursor(Qt::PointingHandCursor);
  static const QHash<QString,QString> help{
    {"theme","选择浅色或深色主题，涨跌颜色随主题保持清晰。"},
    {"toggleWatchlistGroups","展开或收起分组列表，不改变自选和持仓。"},
    {"manage","编辑本机自选与分组；先预览更改再保存。"},
    {"overlay","显示或隐藏当前周期的移动平均线；周期可在参数中修改。"},
    {"nine","显示或隐藏九转计数；计数是图表条件标记，不代表买卖指令。"},
    {"latest","回到当前图表最新已取得的数据位置。"},
    {"openChart","进入当前标的图表分析。"},
    {"funds","打开当前标的资金历史，查看主力分类及明暗盘模型数据。"},
    {"auction","查看当前标的开盘和收盘集合竞价记录。"},
    {"parameters","调整均线和副图指标参数。"},
    {"explain","说明当前指标的计算口径、触发条件与缺数情况。"},
    {"footerDetails","查看当前图表选点的条件与依据，返回可继续看图。"},
    {"openStockResearch","打开当前公司的研究资料与已保存分析。"},
    {"dualCharts","并列查看当前周期和周K；窄窗口保留单图。"},
    {"refreshLive","更新报价及当前图表；失败保留已保存数据并显示原时间。"},
    {"openMarketOverview","查看指数小图、市场概况及来源实际返回的板块数据。"},
    {"openMarketComparison","对比所选指数、板块或股票走势与收益率相关系数。"},
    {"openGlobalMarket","查看全球指数、期货CFD及汇率；交易时段与来源时间单独显示。"},
    {"openLegacyHighFrequency","只读查看旧程序已保存的5秒、30秒档案；不能补出从未采集的过去行情。"},
    {"openSectorWatch","选择独立板块来源并查看目录、成员和K线。"},
    {"openRecent","返回最近查看的标的。"},
    {"importWatchlist","从文件预览导入自选；导入前应保留现有清单备份。"},
    {"exportWatchlist","导出当前自选为JSON，可供其他端导入。"}
  };
  if(help.contains(id))b->setToolTip(help.value(id));
  return b;
}
Window::Window(bool test, const QString& testSettingsFile,
               const QString& dataDirectoryOverride)
    : ui(new Ui::ReviewWindow), testing(test) {
  Q_INIT_RESOURCE(resources);
  ui->setupUi(this);
  if (testing && dataDirectoryOverride.isEmpty()) businessTestDirectory = std::make_unique<QTemporaryDir>();
  const QString dataDirectory = !dataDirectoryOverride.isEmpty()
      ? dataDirectoryOverride
      : (testing ? businessTestDirectory->path()
                 : QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation));
  businessStore = std::make_shared<BusinessStore>(
      dataDirectory + "/business-v1.sqlite");
  recentStore = std::make_shared<RecentStore>(
      QFileInfo(businessStore->filePath()).absolutePath() + "/recent-v1.sqlite");
  collectionPipeline=new CollectionPipeline(businessStore,dataDirectory+"/collection-media",this);
  connect(qApp,&QGuiApplication::applicationStateChanged,this,[this](Qt::ApplicationState value){
    if(value!=Qt::ApplicationActive&&feed) feed->cancelCapitalDay();
    bool foreground=value==Qt::ApplicationActive&&!isMinimized();
    if(industryTopicRuntime){if(foreground)industryTopicRuntime->start();else industryTopicRuntime->stop();}
    if(auto*p=dynamic_cast<IndustryTopicPage*>(pages.value("industryTopic")))p->setActive(foreground&&p->isVisible());
  });
  QTimer::singleShot(0,this,[this]{if(QFile::exists(industryTopicDirectory()+"/state.json")&&QGuiApplication::applicationState()==Qt::ApplicationActive&&!isMinimized())ensureIndustryTopicRuntime()->start();});
  setWindowTitle("Stock · 原生看盘与研究");
  ui->navLayout->setContentsMargins(12, 3, 10, 3);
  ui->navLayout->setSpacing(4);
  ui->toolbarLayout->setContentsMargins(10, 3, 10, 3);
  ui->toolbarLayout->setSpacing(4);
  ui->rootLayout->setStretch(2, 1);
  workspaceTabs = new CurrentWorkspaceTabs(this);
  workspaceTabs->setObjectName("workspaceTabs");
  workspaceTabs->setDocumentMode(true);
  workspaceTabs->setTabsClosable(true);
  // Keep page instances/drafts, but navigate through the existing menu only.
  workspaceTabs->tabBar()->hide();
  ui->rootLayout->removeWidget(ui->body);
  ui->rootLayout->insertWidget(2, workspaceTabs, 1);
  ui->body->setProperty("workspace", "主页");
  ui->body->setProperty("pageTitle", "行情工作台");
  workspaceTabs->addTab(ui->body, "行情工作台");
  workspaceTabs->tabBar()->setTabButton(0, QTabBar::RightSide, nullptr);
  workspaceTabs->tabBar()->setTabButton(0, QTabBar::LeftSide, nullptr);
  lastPage=ui->body;qApp->installEventFilter(this);
  connect(workspaceTabs, &QTabWidget::tabCloseRequested, this,
          [this](int index) {
            if (index == 0) return;
            auto* page = workspaceTabs->widget(index);
            workspaceTabs->removeTab(index);
            page->hide();  // Retain the controls and their state for reopening.
          });
  connect(workspaceTabs, &QTabWidget::currentChanged, this, [this](int index) {
    auto* page = workspaceTabs->widget(index);
    if(page&&page!=lastPage){if(lastPage&&!returningPage)pageHistory.append(lastPage);lastPage=page;}
    if(feed&&page!=ui->body)feed->cancelSamples();
    if(feed&&page!=pages.value("funds")) feed->cancelCapitalDay();
    if (!page) return;
    if(auto*p=dynamic_cast<IndustryTopicPage*>(pages.value("industryTopic")))p->setActive(p==page&&QGuiApplication::applicationState()==Qt::ApplicationActive&&!isMinimized());
    if(auto* monitor=dynamic_cast<paperHost::Page*>(pages.value("paperMonitor")))monitor->setActive(monitor==page&&QGuiApplication::applicationState()==Qt::ApplicationActive);
    if(auto* video=dynamic_cast<ArchiveVideoReviewPage*>(pages.value("archiveVideo")))video->setActive(video==page);
    ui->toolbar->hide();
    if (marketStrip) marketStrip->hide();
    auto* nav = findChild<QPushButton*>("workspace" +
                                        page->property("workspace").toString());
    if (nav) {
      activeWorkspace = nav;
      nav->setChecked(true);
    }
    syncNavigation();
  });
  if (!test || !testSettingsFile.isEmpty()) {
    settings = std::make_unique<QSettings>(
        test ? testSettingsFile : dataDirectory + "/review.ini",
        QSettings::IniFormat);
    // The former linked workspace is now a wide-chart submode.
    mode = settings->value("layout", "classic").toString();
    dualCharts =
        mode == "matrix" || settings->value("dualCharts", false).toBool();
    if (mode == "matrix") mode = "focus";
    dark = settings->value("dark", true).toBool();
    themeId=appearance::theme(settings->value("appearance/theme",dark?"navy":"soft").toString()).id;
    dark=appearance::theme(themeId).dark;
  }
  if (testing) {
    QFile file(":/review-data.json");
    file.open(QIODevice::ReadOnly);
    instruments = QJsonDocument::fromJson(file.readAll())
                      .object()["instruments"]
                      .toArray();
  } else {
    QString dir = dataDirectory + "/live";
    feed = new MarketFeed(dir, this);
    QString seed = QCoreApplication::applicationDirPath() + "/watchlist.json";
    for (const auto& arg : QCoreApplication::arguments())
      if (arg.startsWith("--watchlist=")) seed = arg.mid(12);
    try {
      feed->loadSeed(seed);
    } catch (const std::exception& e) {
      feed->lastError = QString::fromUtf8(e.what());
    }
    instruments = feed->instruments;
  }
  auto* brand = new QLabel("<img src=\":/stock-icon.png\" width=\"24\" height=\"24\"/>  Stock");
  brand->setMinimumWidth(160);
  brand->setObjectName("brand");
  ui->navLayout->addWidget(brand);
  auto* workspaces = new QButtonGroup(this);
  for (auto label :
       {"主页", "自选与账户", "资金", "研究", "采集", "模拟", "设置"}) {
    auto* b = button(QString::fromUtf8(label),
                     "workspace" + QString::fromUtf8(label));
    b->setProperty("navigation", true);
    b->setCheckable(true);
    workspaces->addButton(b);
    b->setChecked(QString::fromUtf8(label) == "主页");
    if (b->isChecked()) activeWorkspace = b;
    b->setMinimumHeight(28);
    ui->navLayout->addWidget(b);
    connect(b, &QPushButton::clicked, this, [this, label, b] {
      if (QString::fromUtf8(label) == "主页") {
        if (closeInternalReader()) { if (activeWorkspace) activeWorkspace->setChecked(true); return; }
        home();
        chart->setFocus();
        activeWorkspace = b;
        b->setChecked(true);
      } else if (QString::fromUtf8(label) == "自选与账户") {
        accountView();
      } else if (QString::fromUtf8(label) == "模拟") {
        accountView(true);
      } else if (QString::fromUtf8(label) == "研究") {
        researchView();
      } else if (QString::fromUtf8(label) == "设置") {
        settingsView();
      } else if (QString::fromUtf8(label) == "资金") {
        funds();
      } else if (QString::fromUtf8(label) == "采集") {
        collectionView();
      }
    });
  }
  ui->navLayout->addStretch();
  auto* theme = button("配色", "theme");
  ui->navLayout->addWidget(theme);
  auto* themeMenu=new QMenu(theme);
  for(auto id:appearance::ids()){
    auto* action=themeMenu->addAction(appearance::theme(id).name);
    connect(action,&QAction::triggered,this,[this,id]{selectTheme(id);});
  }
  theme->setMenu(themeMenu);
  ui->toolbarLayout->addWidget(new QLabel("  看盘工作台  "));
  auto* legacyArchiveButton=button("旧版数据", "openLegacyArchive");
  ui->toolbarLayout->addWidget(legacyArchiveButton);
  connect(legacyArchiveButton,&QPushButton::clicked,this,&Window::legacyArchiveView);
  auto* recent = button("最近查看", "openRecent");
  ui->toolbarLayout->addWidget(recent);
  connect(recent, &QPushButton::clicked, this, &Window::recentView);
  layoutButtons = new QButtonGroup(this);
  for (auto pair : {qMakePair(QString("quotes"), QString("报价总览")),
                    qMakePair(QString("classic"), QString("经典盯盘")),
                    qMakePair(QString("focus"), QString("宽图分析"))}) {
    auto* b = button(pair.second, "layout" + pair.first);
    b->setCheckable(true);
    layoutButtons->addButton(b);
    ui->toolbarLayout->addWidget(b);
    connect(b, &QPushButton::clicked, this,
            [this, pair] { setLayoutMode(pair.first); });
  }
  auto* sector = button("板块观察", "openSectorWatch");
  ui->toolbarLayout->addWidget(sector);
  connect(sector, &QPushButton::clicked, this, &Window::sectorWatchView);
  auto* overview=button("市场全景 / 热度", "openMarketOverview");ui->toolbarLayout->addWidget(overview);
  auto* legacyHistory=button("旧5秒 / 30秒历史", "openLegacyHighFrequency");ui->toolbarLayout->addWidget(legacyHistory);connect(legacyHistory,&QPushButton::clicked,this,&Window::legacyHighFrequencyView);
  connect(overview,&QPushButton::clicked,this,&Window::marketOverviewView);
  auto* comparison=button("大盘对比", "openMarketComparison");
  ui->toolbarLayout->addWidget(comparison);
  connect(comparison,&QPushButton::clicked,this,&Window::marketComparisonView);
  auto* global=button("全球行情", "openGlobalMarket");
  ui->toolbarLayout->addWidget(global);
  connect(global,&QPushButton::clicked,this,&Window::globalMarketView);
  auto* leaders = button("人工龙头", "openSectorLeaders");
  ui->toolbarLayout->addWidget(leaders);
  connect(leaders, &QPushButton::clicked, this, &Window::sectorLeadersView);
  auto* news = button("资讯", "openNews");
  ui->toolbarLayout->addWidget(news);
  connect(news, &QPushButton::clicked, this, [this] { newsView(); });
  context = new QLabel("同一标的 · 布局切换保留历史位置");
  context->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
  ui->toolbarLayout->addWidget(context);
  ui->toolbarLayout->addStretch();
  dataState = new QLabel(testing ? "● 模拟测试" : "● 公开行情 · 核对源时间");
  ui->toolbarLayout->addWidget(dataState);
  if (feed) {
    auto* refresh = button("刷新", "refreshLive");
    ui->toolbarLayout->addWidget(refresh);
    connect(refresh, &QPushButton::clicked, this, &Window::refreshLive);
    auto* imports = button("导入自选", "importWatchlist");
    ui->toolbarLayout->addWidget(imports);
    connect(imports, &QPushButton::clicked, this, [this] {
      auto path = QFileDialog::getOpenFileName(
          this, "导入自选（原库只读）", {}, "自选文件 (*.json *.db *.sqlite)");
      if (path.isEmpty()) return;
      if (QMessageBox::question(this, "替换本机自选？",
                                "只替换原生程序自己的清单，不改写原数据库。建议"
                                "先导出当前清单留档。") != QMessageBox::Yes)
        return;
      try {
        feed->importFile(path);
        refreshLive();
      } catch (const std::exception& e) {
        QMessageBox::warning(this, "导入未完成", QString::fromUtf8(e.what()));
      }
    });
    auto* exports = button("导出自选", "exportWatchlist");
    ui->toolbarLayout->addWidget(exports);
    connect(exports, &QPushButton::clicked, this, [this] {
      auto path = QFileDialog::getSaveFileName(this, "导出供安卓导入的自选",
                                               "自选.json", "JSON (*.json)");
      if (path.isEmpty()) return;
      try {
        feed->exportFile(path);
      } catch (const std::exception& e) {
        QMessageBox::warning(this, "导出未完成", QString::fromUtf8(e.what()));
      }
    });
  }
  marketStrip = new QLabel;
  marketStrip->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
  marketStrip->setObjectName("marketStrip");
  QString ticker;
  for (auto v : instruments) {
    auto s = v.toObject();
    if (!testing || s["group"].toString() != "指数") continue;
    auto data = s["day"].toArray();
    double last = data.last().toObject()["close"].toDouble();
    double pct =
        (last / data[data.size() - 2].toObject()["close"].toDouble() - 1) * 100;
    ticker += QString(
                  "<span style='color:#8d9bb0'>%1</span>　<b "
                  "style='color:%2'>%3　%4%</b>　　　　")
                  .arg(s["name"].toString(), pct >= 0 ? "#ec5866" : "#24b898",
                       QString::number(last, 'f', pricePrecision(s)),
                       QString::number(pct, 'f', 2));
  }
  marketStrip->setText(
      !testing ? "新浪公开报价 / 腾讯公开K线与分时 · "
                 "按来源时间显示，不承诺逐笔实时 · 可点击刷新"
               : ticker.replace(QChar(0x3000), "&nbsp;&nbsp;") +
                     "<span "
                     "style='color:#8d9bb0'>本地样本&nbsp;&nbsp;｜&nbsp;&"
                     "nbsp;07-25&nbsp;&nbsp;形成中</span>");
  ui->rootLayout->insertWidget(2, marketStrip);
  ui->rootLayout->setStretch(2, 0);
  ui->rootLayout->setStretch(3, 1);
  groupPanel = new QWidget;
  groupPanel->setObjectName("groupPanel");
  auto* gl = new QVBoxLayout(groupPanel);
  gl->setContentsMargins(8, 6, 8, 6);
  auto* groupTitle = new QLabel("我的分组");
  groupTitle->setObjectName("sectionTitle");
  gl->addWidget(groupTitle);
  groups = new QListWidget;
  groups->setObjectName("groups");
  renderWatchlistDirectory();
  groups->setMinimumWidth(125);
  groups->setWordWrap(true);
  groups->setTextElideMode(Qt::ElideNone);
  groups->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
  gl->addWidget(groups, 1);
  auto* manage = button("管理自选 / 分组", "manage");
  gl->addWidget(manage);
  connect(manage, &QPushButton::clicked, this, &Window::editGroups);
  ui->body->addWidget(groupPanel);
  stockPanel = new QWidget;
  auto* sl = new QVBoxLayout(stockPanel);
  sl->setContentsMargins(6, 6, 6, 0);
  search = new QLineEdit(stockPanel);
  search->setObjectName("search");
  search->setPlaceholderText("名称 / 代码 / 主营");
  search->setToolTip("统一搜索：自选、全市场名称/代码/拼音、主营资料。输入搜索本地数据，回车公开深搜；清空返回图表。");
  search->setClearButtonEnabled(true);
  search->setMinimumHeight(30);
  auto* stockSearchRow=new QHBoxLayout;auto* toggleGroups=button("分组","toggleWatchlistGroups",stockPanel);stockSearchRow->addWidget(toggleGroups);stockSearchRow->addWidget(search,1);sl->addLayout(stockSearchRow);
  connect(toggleGroups,&QPushButton::clicked,this,[this]{if(auto* action=findChild<QAction*>("showWatchlistGroups"))action->toggle();});
  auto* searchHint = new QLabel("输入即搜索 · 回车联网 · 点击结果看图", stockPanel);
  searchHint->setObjectName("muted");
  sl->addWidget(searchHint);
  stocks = new QTableWidget(0, 10);
  stocks->setObjectName("stocks");
  stocks->setHorizontalHeaderLabels({"名称 / 代码", "最新价", "涨跌幅",
                                     "涨跌额", "近期走势", "今开", "最高",
                                     "最低", "成交量(股)", "昨收"});
  stocks->verticalHeader()->hide();
  stocks->verticalHeader()->setDefaultSectionSize(38);
  stocks->setSelectionBehavior(QAbstractItemView::SelectRows);
  stocks->setSelectionMode(QAbstractItemView::SingleSelection);
  stocks->setEditTriggers(QAbstractItemView::NoEditTriggers);
  stocks->setShowGrid(false);
  stocks->horizontalHeader()->setMinimumSectionSize(60);
  stocks->horizontalHeader()->setFixedHeight(28);
  stocks->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
  stocks->setItemDelegate(new QuoteDelegate(stocks));
  stocks->setItemDelegateForColumn(4, new SparkDelegate(stocks));
  stocks->setItemDelegateForColumn(0, new NameDelegate(stocks));
  stocks->setAlternatingRowColors(true);
  stocks->setSortingEnabled(true);
  stocks->horizontalHeader()->setSortIndicator(-1, Qt::AscendingOrder);
  stocks->setWordWrap(false);
  sl->addWidget(stocks, 1);
  auto* stockFoot = new QLabel("点击表头排序 · 单击联动 · 双击读图");
  stockFoot->setObjectName("muted");
  sl->addWidget(stockFoot);
  stockPanel->setMinimumWidth(280);
  ui->body->addWidget(stockPanel);
  auto* center = new QWidget;
  centerPanel = center;
  auto* cl = new QVBoxLayout(center);
  cl->setContentsMargins(8, 5, 8, 0);
  cl->setSpacing(3);
  quote = new QLabel;
  quote->setObjectName("quote");
  quote->setWordWrap(true);quote->setFixedHeight(qMax(58,quote->fontMetrics().height()*3+8));
  quote->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
  cl->addWidget(quote);
  auto* tools = new QHBoxLayout;
  periodButtons = new QButtonGroup(this);
  auto* periodRow=new QWidget;auto* periodLayout=new QHBoxLayout(periodRow);
  periodRow->setObjectName("chartPeriodRow");periodLayout->setContentsMargins(0,0,0,0);periodLayout->setSpacing(4);
  for (auto pair : {qMakePair(QString("minute5s"), QString("5秒")),
                    qMakePair(QString("minute30s"), QString("30秒")),
                    qMakePair(QString("minute"), QString("1分钟")),
                    qMakePair(QString("day"), QString("日K")),
                    qMakePair(QString("week"), QString("周K")),
                    qMakePair(QString("month"), QString("月K")),
                    qMakePair(QString("year"), QString("年K"))}) {
    auto* b = button(pair.second, "period" + pair.first);
    b->setCheckable(true);
    periodButtons->addButton(b);
    periodLayout->addWidget(b);
    b->setToolTip(pair.first.startsWith("minute")&&pair.first!="minute"?
      "按所选秒数汇总公开分笔；仅展示来源实际返回或本机已采集时段，缺口不补价。":
      pair.first=="year"?"将来源月线按自然年汇总为年K；当年未收盘部分保留形成中标记。":
      "切换图表周期；显示该周期的已保存数据，并请求公开来源更新。");
    connect(b, &QPushButton::clicked, this,
            [this, pair] { setPeriod(pair.first); });
  }
  periodLayout->addStretch();
  auto* periodScroll=new QScrollArea;periodScroll->setObjectName("chartPeriodScroll");
  periodScroll->setWidget(periodRow);periodScroll->setWidgetResizable(true);periodScroll->setFrameShape(QFrame::NoFrame);
  periodScroll->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);periodScroll->setFixedHeight(periodRow->sizeHint().height()+8);
  cl->addWidget(periodScroll);
  auto* ema = button("均线", "overlay");
  ema->setCheckable(true);
  ema->setChecked(true);
  tools->addWidget(ema);
  auto* nine = button("九转", "nine");
  nine->setCheckable(true);
  nine->setChecked(true);
  tools->addWidget(nine);
  tools->addStretch();
  auto* latest = button("回到最新", "latest");
  tools->addWidget(latest);
  openChartButton = button("展开分析 ↗", "openChart");
  tools->addWidget(openChartButton);
  connect(openChartButton, &QPushButton::clicked, this,
          [this] { setLayoutMode("focus"); recordViewedInstrument(); });
  indicatorRow = new QWidget;
  indicatorRow->setObjectName("mainChartActions");
  auto* indicators = new CompactActions(indicatorRow);
  indicators->takeFrom(tools);delete tools;
  indicators->setContentsMargins(0, 0, 0, 0);
  indicatorButtons = new QButtonGroup(this);
  indicatorChoices = new QWidget;
  auto* choices = new QHBoxLayout(indicatorChoices);
  choices->setContentsMargins(0, 0, 0, 0);
  choices->setSpacing(3);
  indicatorSelector = new QComboBox;
  indicatorSelector->setObjectName("indicatorSelector");
  indicatorSelector->setAccessibleName("副图指标");
  for (QString name : {"MACD", "ATR", "RVOL", "KDJ", "RSI", "CCI", "OBV"}) {
    auto* b = button(name, "indicator" + name);
    b->setProperty("indicatorControl", true);
    b->setCheckable(true);
    b->setChecked(name == "MACD");
    indicatorButtons->addButton(b);
    choices->addWidget(b);
    indicatorSelector->addItem(name);
    connect(b, &QPushButton::clicked, this, [this, name] {
      selectIndicator(name);
    });
  }
  // Retain existing settings/test bindings; the visible control belongs to Chart.
  indicatorChoices->setParent(indicatorRow);
  indicatorSelector->setParent(indicatorRow);
  indicatorSelector->hide();
  indicatorChoices->hide(); // Do not impose a wide minimum on narrow windows.
  connect(indicatorSelector, &QComboBox::activated, this, [this](int) {
    selectIndicator(indicatorSelector->currentText());
  });
  auto* precision = new QComboBox;
  precision->setObjectName("minutePrecision");
  precision->addItem("分时：源1分钟历史", 0);
  precision->addItem("分时：腾讯5秒汇总", 5);
  precision->addItem("分时：腾讯30秒汇总", 30);
  precision->setToolTip("从腾讯公开分笔回补当日价格，再增量更新；不是交易所完整逐笔，未返回的时段不补价。");
  precision->setParent(indicatorRow);precision->hide();
  connect(precision, &QComboBox::currentIndexChanged, this,
          [this, precision](int) {
            samplingSeconds = precision->currentData().toInt();
            setPeriod(samplingSeconds?QString("minute%1s").arg(samplingSeconds):QString("minute"));
          });
  auto* fundButton = button("资金", "funds");
  indicators->addWidget(fundButton);
  connect(fundButton, &QPushButton::clicked, this, &Window::funds);
  auto* auctionButton = button("竞价", "auction");
  indicators->addWidget(auctionButton);
  connect(auctionButton, &QPushButton::clicked, this, &Window::auctionView);
  auto* params = button("参数", "parameters");
  indicators->addWidget(params);
  connect(params, &QPushButton::clicked, this, &Window::parameters);
  auto* explain = button("信号解释", "explain");
  indicators->addWidget(explain);
  auto* stockResearch = button("个股研究", "openStockResearch");
  indicators->addWidget(stockResearch);
  connect(stockResearch, &QPushButton::clicked, this, [this] { stockResearchView(); });
  dualButton = button("双周期", "dualCharts");
  dualButton->setCheckable(true);
  indicators->addWidget(dualButton);
  connect(dualButton, &QPushButton::toggled, this, [this](bool on) {
    dualCharts = on;
    arrangeWorkspace();
    save();
  });
  cl->addWidget(indicatorRow);
  chartReadout = new QLabel;
  chartReadout->setObjectName("chartReadout");
  chartReadout->setWordWrap(true);chartReadout->setFixedHeight(chartReadout->fontMetrics().height()*2+8);
  chartReadout->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
  cl->addWidget(chartReadout);
  charts = new QSplitter(Qt::Horizontal);
  chart = new Chart;
  chart->setObjectName("chart");
  connect(chart->findChild<QPushButton*>("chartEmptyMinute"),&QPushButton::clicked,this,[this,precision]{
    precision->setCurrentIndex(0);
    if(period!="minute")setPeriod("minute");
  });
  connect(chart->findChild<QPushButton*>("chartEmptySecondsHistory"),&QPushButton::clicked,this,[this]{
    const auto id=activeId;const int seconds=samplingSeconds;
    legacyHighFrequencyView();
    if(auto* page=qobject_cast<LegacyHighFrequencyPage*>(pages.value("legacyHighFrequency")))
      page->restoreState({{"schema","native-legacy-highfreq-ui/v1"},{"id",id},
                         {"code",id.section(':',2)},{"seconds",seconds}});
  });
  referenceChart = new Chart;
  for(auto* target:{chart,referenceChart})
    connect(target,&Chart::indicatorChanged,this,&Window::selectIndicator);
  if (settings)
    for (auto* c : {chart, referenceChart}) {
      c->annotationsEnabled=settings->value("chartAnnotations",false).toBool();
      c->vwapEnabled=settings->value("vwapEnabled",false).toBool();
      c->vwapMode=settings->value("vwapMode","legacy-close-approx").toString();
      c->vwapAnchor=settings->value("vwapAnchor","auto").toString();
      c->emaPeriod = std::clamp(settings->value("ema", 20).toInt(), 2, 120);
      c->atrPeriod = std::clamp(settings->value("atr", 14).toInt(), 2, 120);
      c->volumePeriod = std::clamp(settings->value("rvol", 20).toInt(), 2, 120);
      c->maType =
          settings->value("maType", "MA").toString() == "EMA" ? "EMA" : "MA";
      QList<int> periods;
      for (auto word :
           settings->value("maPeriods", "5,10,20,60").toString().split(',')) {
        bool ok = false;
        int n = word.toInt(&ok);
        if (ok && n >= 1 && n <= 500 && !periods.contains(n) &&
            periods.size() < 12)
          periods << n;
      }
      if (!periods.isEmpty()) c->maPeriods = periods;
      c->macdFast = std::clamp(settings->value("macdFast", 12).toInt(), 1, 499);
      c->macdSlow = std::clamp(settings->value("macdSlow", 26).toInt(),
                               c->macdFast + 1, 500);
      c->macdSignal =
          std::clamp(settings->value("macdSignal", 9).toInt(), 1, 500);
      c->kdjPeriod = std::clamp(settings->value("kdjPeriod", 9).toInt(), 1, 500);
      c->rsiPeriod = std::clamp(settings->value("rsiPeriod", 14).toInt(), 1, 500);
      c->cciPeriod = std::clamp(settings->value("cciPeriod", 14).toInt(), 1, 500);
      const auto selected = settings->value("indicator", "MACD").toString();
      if (indicatorSelector->findText(selected) >= 0) c->indicator = selected;
    }
  indicatorSelector->setCurrentText(chart->indicator);
  indicatorChoices->findChild<QPushButton*>("indicator" + chart->indicator)->setChecked(true);
  referenceChart->setObjectName("referenceChart");
  referenceChart->setMinimumHeight(240);
  charts->addWidget(chart);
  charts->addWidget(referenceChart);
  cl->addWidget(charts, 1);
  focusFooter = new QWidget;
  focusFooter->setObjectName("focusFooter");
  auto* footerLayout = new QHBoxLayout(focusFooter);
  footerLayout->setContentsMargins(2, 5, 2, 5);
  footerSummary = new QLabel;
  footerSummary->setWordWrap(true);
  footerSummary->setFixedHeight(footerSummary->fontMetrics().height()*2+8);
  footerSummary->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
  footerLayout->addWidget(footerSummary, 1);
  auto* footerDetails = button("条件依据 →", "footerDetails");
  footerLayout->addWidget(footerDetails);
  connect(footerDetails, &QPushButton::clicked, explain, &QPushButton::click);
  cl->addWidget(focusFooter);
  ui->body->addWidget(center);
  signalPanel = new QWidget;
  auto* el = new QVBoxLayout(signalPanel);
  el->setContentsMargins(8, 6, 10, 6);
  auto* detailTitle = new QLabel("行情快照");
  detailTitle->setObjectName("sectionTitle");
  el->addWidget(detailTitle);
  snapshot = new QLabel;
  snapshot->setWordWrap(true);
  snapshot->setObjectName("snapshot");
  el->addWidget(snapshot);
  auto* bookPanel = new QWidget;
  bookPanel->setObjectName("orderBook");
  auto* bookLayout = new QVBoxLayout(bookPanel);
  bookLayout->setContentsMargins(0, 0, 0, 0);
  bookState = new QLabel;
  bookState->setObjectName("sectionTitle");
  bookLayout->addWidget(bookState);
  auto* publicDetails=button("历史报价记录", "openPublicPriceDetails", bookPanel);
  publicDetails->setToolTip("查看以前保存的公开报价记录，不是实时逐笔成交");
  bookLayout->addWidget(publicDetails);
  connect(publicDetails,&QPushButton::clicked,this,&Window::publicPriceDetailView);
  bookRows = new QLabel(
      "<table width='100%' cellspacing='5'>"
      "<tr><td>卖五</td><td align='right'>—</td><td align='right'>—</td></tr>"
      "<tr><td>卖四</td><td align='right'>—</td><td align='right'>—</td></tr>"
      "<tr><td>卖三</td><td align='right'>—</td><td align='right'>—</td></tr>"
      "<tr><td>卖二</td><td align='right'>—</td><td align='right'>—</td></tr>"
      "<tr><td>卖一</td><td align='right'>—</td><td align='right'>—</td></tr>"
      "<tr><td>买一</td><td align='right'>—</td><td align='right'>—</td></tr>"
      "<tr><td>买二</td><td align='right'>—</td><td align='right'>—</td></tr>"
      "<tr><td>买三</td><td align='right'>—</td><td align='right'>—</td></tr>"
      "<tr><td>买四</td><td align='right'>—</td><td align='right'>—</td></tr>"
      "<tr><td>买五</td><td align='right'>—</td><td "
      "align='right'>—</td></tr></table>");
  bookLayout->addWidget(bookRows);
  el->addWidget(bookPanel);
  auto* signalTitle = new QLabel("信号速览");
  signalTitle->setObjectName("sectionTitle");
  el->addWidget(signalTitle);
  signalSummary = new QLabel;
  signalSummary->setWordWrap(true);
  signalSummary->setObjectName("signalSummary");
  el->addWidget(signalSummary);
  auto* details = button("信号说明", "signalDetails");
  details->setToolTip("查看当前信号为什么出现、满足了哪些条件");
  el->addWidget(details);
  connect(details, &QPushButton::clicked, explain, &QPushButton::click);
  auto* boundary =
      new QLabel(testing ? "信号描述历史条件，不构成买卖建议。\n数据：内置模拟"
                           "样本\n买卖盘：未提供，不补造"
                         : "新浪公开报价 / "
                           "腾讯公开K线。\n以各自来源时间为准，不承诺交易所实时"
                           "性。\n信号解释历史条件，不构成买卖建议。");
  boundary->setObjectName("muted");
  boundary->setWordWrap(true);
  el->addWidget(boundary);
  el->addStretch();
  explanation = new QTextBrowser;
  explanation->setOpenExternalLinks(false);
  explanation->setParent(signalPanel);
  explanation->hide();
  signalPanel->setMinimumWidth(220);
  ui->body->addWidget(signalPanel);
  connect(chart, &Chart::barSelected, this, &Window::showExplanation);
  connect(referenceChart, &Chart::barSelected, this,
          [this](int i) { explainChart(referenceChart, i); });
  connect(latest, &QPushButton::clicked, chart, &Chart::latest);
  connect(ema, &QPushButton::toggled, this, [this](bool on) {
    for (auto* target : {chart, referenceChart}) {
      target->overlay = on;
      target->update();
    }
  });
  connect(nine, &QPushButton::toggled, this, [this](bool on) {
    for (auto* target : {chart, referenceChart}) {
      target->showNine = on;
      target->update();
    }
  });
  connect(explain, &QPushButton::clicked, this, [this] {
    recordViewedInstrument();
    auto key = "signal:" + activeId;
    auto* d = pages.value(key);
    if (!d) {
      d = businessPage(key, instrument["name"].toString() + " · 信号说明", "主页");
      d->setProperty("workbenchChild",true);
      auto* l = new QVBoxLayout(d);
      auto* back=new QPushButton("← 返回看盘（Esc）",d);back->setObjectName("signalBack");
      l->addWidget(back,0,Qt::AlignLeft);connect(back,&QPushButton::clicked,this,&Window::home);
      auto* hint=new QLabel("信号说明 · 查看当前信号的触发条件和计算依据，不代表买卖建议。",d);hint->setWordWrap(true);l->addWidget(hint);
      auto* text = new QTextBrowser;
      text->setObjectName("signalEvidence");
      l->addWidget(text);
    }
    auto* text = d->findChild<QTextBrowser*>("signalEvidence");
    text->setHtml(explanation->toHtml());
    activatePage(d);
  });
  auto* unifiedDebounce = new QTimer(this);
  unifiedDebounce->setSingleShot(true); unifiedDebounce->setInterval(180);
  connect(unifiedDebounce, &QTimer::timeout, this, [this]{updateUnifiedSearch();});
  connect(search, &QLineEdit::returnPressed, this, [this,unifiedDebounce]{unifiedDebounce->stop();updateUnifiedSearch(true);});
  connect(search, &QLineEdit::textChanged, this, [this,unifiedDebounce] {
    QScopedValueRollback<bool> reuseDirectory(liveQuoteRefresh,true);
    fillStocks();
    if(search->text().trimmed().isEmpty()){unifiedDebounce->stop();closeUnifiedSearch();}
    else unifiedDebounce->start();
  });
  connect(groups, &QListWidget::currentRowChanged, this, [this] {
    setProperty("pinObservedInstrument",QString());
    fillStocks();
    if (stocks->rowCount() > 0)
      loadInstrument(stocks->item(0, 0)->data(Qt::UserRole).toString());
  });
  connect(stocks, &QTableWidget::cellClicked, this, [this](int row, int) {
    const QString id = stocks->item(row, 0)->data(Qt::UserRole).toString();
    if (id != activeId) loadInstrument(id);
    if (mode != "quotes") recordViewedInstrument();
    closeUnifiedSearch();
  });
  connect(stocks, &QTableWidget::cellDoubleClicked, this,
          [this](int, int) {
            if (mode == "quotes") recordViewedInstrument();
            setLayoutMode("focus");
          });
  auto* enterChart = new QShortcut(QKeySequence(Qt::Key_Return), stocks);
  enterChart->setContext(Qt::WidgetShortcut);
  connect(enterChart, &QShortcut::activated, this, [this] {
    if (stocks->currentRow() < 0) return;
    const QString id =
        stocks->item(stocks->currentRow(), 0)->data(Qt::UserRole).toString();
    if (id != activeId) loadInstrument(id);
    setLayoutMode("focus");
    recordViewedInstrument();
  });
  if (settings)
    for (int i = 0; i < groups->count(); ++i) {
      auto* item = groups->item(i);
      QColor color(item->data(Qt::UserRole+1).toString()=="legacy-native-label" ? settings->value("groupColor/" + item->text()).toString() : QString{});
      if (color.isValid()) item->setForeground(color);
    }
  groups->setCurrentRow(0);
  if (!instruments.isEmpty())
    loadInstrument(instruments[0].toObject()["id"].toString());
  setLayoutMode("classic");
  setPeriod("day");
  applyTheme();
  if (feed) {
    // A quote batch persists each symbol separately. Paint the latest snapshot
    // once per short interval, rather than rebuilding the window per callback.
    auto* livePaint = new QTimer(this);
    livePaint->setObjectName("livePaintCoalescer");
    livePaint->setSingleShot(true);livePaint->setInterval(100);
    auto rosterPending=std::make_shared<bool>(false);
    connect(livePaint,&QTimer::timeout,this,[this,rosterPending]{
      const bool changed=*rosterPending;*rosterPending=false;syncLive(changed);
    });
    connect(feed, &MarketFeed::updated, this,
            [livePaint](const QString&) { if(!livePaint->isActive())livePaint->start(); });
    connect(feed, &MarketFeed::rosterChanged, this, [livePaint,rosterPending] {
      *rosterPending=true;if(!livePaint->isActive())livePaint->start();
    });
    auto* timer = new QTimer(this);
    timer->setInterval(60000);
    connect(timer, &QTimer::timeout, this, [this] {
      if(!persistenceClosing&&!persistenceCloseReady&&feed)feed->refreshQuotes();
    });
    timer->start();
    auto* sampleTimer = new QTimer(this);
    sampleTimer->setInterval(5000);
    connect(sampleTimer, &QTimer::timeout, this, [this] {
      if (legacyHighFrequencyFrame.isEmpty() && samplingSeconds && period.startsWith("minute") &&
          ui->body->isVisible() && !isMinimized() && isActiveWindow())
        feed->sample(activeId, samplingSeconds);
    });
    sampleTimer->start();
    QTimer::singleShot(0, this, &Window::refreshLive);
  }
  etfUpdater = new EtfPage(QFileInfo(businessStore->filePath()).absolutePath()+"/etf-daily-v1.sqlite", !testing, this);
  etfUpdater->hide(); // Application-owned schedule survives closing its internal tab.
  setupNavigation();
  if(!testing){
    publicMarketRuntime=new PublicMarketRuntime(QFileInfo(businessStore->filePath()).absolutePath(),true,this);
    publicMarketRuntime->setStocks(instruments);
    QJsonArray initiallyVisible;for(int r=0;r<stocks->rowCount();++r){const auto id=stocks->item(r,0)->data(Qt::UserRole).toString();for(auto v:instruments)if(v.toObject()["id"]==id){initiallyVisible.append(v);break;}}
    publicMarketRuntime->setVisibleStocks(initiallyVisible);
    if(feed)connect(feed,&MarketFeed::rosterChanged,publicMarketRuntime,[this]{publicMarketRuntime->setStocks(feed->instruments);});
    publicMarketRuntime->stockUpdated=[this](QJsonObject row){
      if(!feed)return;const auto id=row["id"].toString();
      // Collection must not register an observation (or trigger roster IO).
      // Interactive first open still hydrates all saved chart periods normally.
      for(int i=0;i<feed->instruments.size();++i){
        const auto existing=feed->instruments[i].toObject();if(existing["id"]!=id)continue;
        feed->instruments[i]=PublicMarketRuntime::mergeStockHistory(existing,row);emit feed->updated(id);return;
      }
      if(auto* page=pages.value("funds"))if(auto* widget=page->findChild<QWidget*>("capitalRoster"))
        static_cast<CapitalWorkbenchRoster*>(widget)->updateSources(publicMarketRuntime->stockView(feed->instruments));
    };
    publicMarketRuntime->updated=[this](QString source){
      if(source=="overview"){if(auto* page=qobject_cast<MarketOverviewPage*>(pages.value("marketOverview")))page->reloadSaved();}
      else if(auto* page=qobject_cast<GlobalMarketPage*>(pages.value("globalMarket")))page->reloadSaved(source);
    };
  }
  try{watchlistBridgeRestoreViews();}catch(const std::exception&e){statusBar()->showMessage(QString::fromUtf8(e.what()));}
  if(!testing)QTimer::singleShot(0,this,[this]{prepareQuantResearch(false);});
}
void Window::syncLive(bool changed) {
  if (!feed) return;
  if(!changed&&instruments==feed->instruments){
    if(dataState)dataState->setToolTip(feed->lastError);
    return;
  }
  instruments = feed->instruments;
  if (changed) renderWatchlistDirectory();
  // Hidden quote panes catch up on return; the reader does not pay for redraws.
  const bool showQuotes=workspaceTabs->currentWidget()==ui->body;
  if(showQuotes||changed){QScopedValueRollback<bool> quoteOnly(liveQuoteRefresh,!changed);fillStocks();}else livePanePending=true;
  if(!legacyHighFrequencyFrame.isEmpty()){activeId=legacyHighFrequencyFrame["id"].toString();dataState->setText(legacyHighFrequency::caption(legacyHighFrequencyFrame));return;}
  bool found = false;
  for (auto s : instruments)
    if (s.toObject()["id"] == activeId) found = true;
  if (!found && !instruments.isEmpty())
    activeId = instruments[0].toObject()["id"].toString();
  if(showQuotes&&!activeId.isEmpty()){
    for(auto value:instruments)if(value.toObject()["id"]==activeId&&value.toObject()!=instrument){loadInstrument(activeId,false);break;}
  }
  if (auto* recent = qobject_cast<RecentPage*>(pages.value("recent")))
    if (recent->isVisible()) recent->applyQuotes(instruments);
}
void Window::refreshLive() {
  if(!legacyHighFrequencyFrame.isEmpty()){statusBar()->showMessage("正在查看旧历史；请先明确返回当前资料再刷新。",8000);return;}
  if (!feed) return;
  if (instruments.isEmpty()) {
    dataState->setText("请导入现有自选");
    return;
  }
  feed->refreshQuotes();
  if (!activeId.isEmpty()) {
    if(period=="minute5s"||period=="minute30s")feed->sample(activeId,period=="minute5s"?5:30,true);
    else feed->chart(activeId, period, true);
    feed->chart(activeId, "week", true);
  }
}
void Window::closeEvent(QCloseEvent* event){
 if(persistenceCloseReady){QMainWindow::closeEvent(event);return;}
 event->ignore();
 if(auto* message=findChild<QMessageBox*>("marketPersistenceCloseFailure");message&&message->isVisible()){message->raise();return;}
 if(persistenceClosing)return;persistenceClosing=true;
 if(centralWidget())centralWidget()->setEnabled(false);
 QList<QPointer<MarketFeed>> sources,waiting;
 for(auto* source:findChildren<MarketFeed*>()){
  sources.append(source);auto state=source->persistenceStats();
  if(!(state["closed"].toBool()&&state["idle"].toBool()))waiting.append(source);
 }
 auto finish=[this,sources]{
  int unresolved=0;for(auto source:sources)if(source)unresolved+=source->persistenceStats()["retainedFailures"].toInt();
  if(unresolved){
   persistenceClosing=false;if(centralWidget())centralWidget()->setEnabled(true);
   statusBar()->showMessage("已接纳行情未全部保存；恢复数据仍保留，窗口未退出");
   auto* message=new QMessageBox(QMessageBox::Warning,"行情保存未完成",
       QString("有%1份已接纳数据尚未成功保存，原始请求已保留。").arg(unresolved),QMessageBox::NoButton,this);
   message->setObjectName("marketPersistenceCloseFailure");message->setAttribute(Qt::WA_DeleteOnClose);
   message->setInformativeText("可重试或导出恢复数据；选择留在窗口后继续更新其他行情，失败原件仍保留。");
   auto* stay=message->addButton("留在窗口",QMessageBox::RejectRole);stay->setObjectName("marketPersistenceStay");
   auto* retry=message->addButton("重试保存",QMessageBox::ActionRole);retry->setObjectName("marketPersistenceRetry");
   auto* exportData=message->addButton("导出恢复数据",QMessageBox::ActionRole);exportData->setObjectName("marketPersistenceExport");
   auto* discard=message->addButton("明确放弃未保存数据并退出",QMessageBox::DestructiveRole);discard->setObjectName("marketPersistenceDiscard");
   message->setDefaultButton(stay);message->setEscapeButton(stay);
   connect(message,&QMessageBox::buttonClicked,this,[this,message,sources,retry,exportData,discard](QAbstractButton* selected){
    if(!message->isVisible())return;
    message->setObjectName({});message->close();
    if(selected==discard){
     for(auto source:sources)if(source)source->discardFailedPersistence();
     if(!saveCloseState()){for(auto source:sources)if(source)source->resumePersistence();return;}
     persistenceCloseReady=true;QTimer::singleShot(0,this,[this]{close();});
    }else if(selected==retry){
     for(auto source:sources)if(source&&!source->failedPersistence().isEmpty())source->retryFailedPersistence();
     QTimer::singleShot(0,this,[this]{close();});
    }else if(selected==exportData){
     for(auto source:sources)if(source)source->resumePersistence();
     // Return from QMessageBox::buttonClicked before a nested file-dialog loop
     // can process the message's deferred deletion.
     QTimer::singleShot(0,this,[this,sources]{
     const auto target=QFileDialog::getSaveFileName(this,"导出未保存行情恢复数据",{},"JSON (*.json)");
     if(target.isEmpty())return;
     QJsonArray packets;for(auto source:sources)if(source&&!source->failedPersistence().isEmpty())
      packets.append(QJsonObject{{"database",source->capitalArchivePath()},{"requests",source->failedPersistence()}});
     const auto raw=QJsonDocument(QJsonObject{{"schema","market-persistence-recovery/v1"},
        {"createdAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"feeds",packets}}).toJson();
     QSaveFile file(target);
     if(!file.open(QIODevice::WriteOnly)||file.write(raw)!=raw.size()||!file.commit())
      statusBar()->showMessage("恢复数据导出失败；内存原始请求仍保留，窗口未退出");
     else statusBar()->showMessage("恢复数据已导出；尚未放弃内存请求，窗口未退出");
     });
    }else{
     for(auto source:sources)if(source)source->resumePersistence();
    }
   });
   message->open();return;
  }
  if(!saveCloseState()){
   persistenceClosing=false;if(centralWidget())centralWidget()->setEnabled(true);
   for(auto source:sources)if(source)source->resumePersistence();
   return;
  }
  persistenceCloseReady=true;QTimer::singleShot(0,this,[this]{close();});
 };
 statusBar()->showMessage("正在保存已接纳行情，当前暂不可操作；完成后继续关闭。");
 auto remaining=std::make_shared<int>(waiting.size());
 auto done=[remaining,finish]{if(--*remaining==0)finish();};
 if(waiting.isEmpty()){finish();return;}
 // Connect all mailboxes before stopPersistence: an idle writer can drain now.
 for(auto source:waiting)if(source)connect(source,&MarketFeed::persistenceDrained,this,done,Qt::SingleShotConnection);
 for(auto source:waiting)if(source)source->stopPersistence();
}
Window::~Window() { if(publicMarketRuntime){delete publicMarketRuntime;publicMarketRuntime=nullptr;} if(auto*p=pages.take("industryTopic"))delete p; if(industryTopicRuntime){industryTopicRuntime->stop();delete industryTopicRuntime;industryTopicRuntime=nullptr;} if(auto*p=dynamic_cast<KnowledgeAiHostPage*>(pages.value("knowledgeAiHost")))p->close(); if(unifiedBackupLane)unifiedBackupLane->closeOwner(); if(auto*p=dynamic_cast<cffexDisclosure::Page*>(pages.value("cffexDisclosure")))p->cancel(); if(auto*p=dynamic_cast<ArchiveVideoReviewPage*>(pages.value("archiveVideo")))p->close(); if(auto*p=dynamic_cast<FuturesMonitorPage*>(pages.value("futuresMonitor")))p->cancel();etfRefreshToken.clear();if(auto*p=qobject_cast<EtfMonitorPage*>(pages.value("etfMonitor")))p->setActive(false);delete collectionPipeline; collectionPipeline=nullptr; save(); }
bool Window::saveCloseState(){
 try {
  for(auto* page:findChildren<QWidget*>()){
   preparePortfolioClose(page);prepareIndustryClose(page);if(page->objectName()=="collectionPage")prepareCollectionClose(page);
   if(auto* p=dynamic_cast<ResearchWorkbenchPage*>(page))p->prepareClose();
   if(auto* p=dynamic_cast<IndustryTopicPage*>(page))p->saveState();
   if(auto* p=dynamic_cast<KnowledgeAiHostPage*>(page))p->saveState();
   if(auto* p=dynamic_cast<paperHost::Page*>(page))p->saveState();
  }
  return save();
 }catch(const std::exception& e){statusBar()->showMessage(QString::fromUtf8(e.what()));return false;}
}
bool Window::save() {
 try {
  // QSettings keeps its first error for the lifetime of the instance. Retrying
  // after the storage problem is fixed needs a fresh writer, not a new path.
  if(settings&&settings->status()!=QSettings::NoError){
   auto retry=std::make_unique<QSettings>(settings->fileName(),settings->format());
   retry->setFallbacksEnabled(settings->fallbacksEnabled());
   for(const auto& key:settings->allKeys())retry->setValue(key,settings->value(key));
   settings=std::move(retry);
  }
  saveCffexDisclosureState(true);
  if(settings)if(auto*p=dynamic_cast<FuturesMonitorPage*>(pages.value("futuresMonitor")))settings->setValue("futuresMonitor/state",QJsonDocument(p->saveState()).toJson(QJsonDocument::Compact));
  if(settings)if(auto*p=qobject_cast<GlobalMarketPage*>(pages.value("globalMarket")))settings->setValue("globalMarket/state",QJsonDocument(p->saveState()).toJson(QJsonDocument::Compact));
  if(settings)if(auto*p=qobject_cast<EtfMonitorPage*>(pages.value("etfMonitor")))settings->setValue("etfMonitor/state",QJsonDocument(p->saveState()).toJson(QJsonDocument::Compact));
  saveAccountEditView();
  if(pages.contains("watchlistHost")||pages.contains("watchlistWorkspace")||pages.contains("watchlistReconciliation"))watchlistBridgeSaveViews();
  {
    QJsonObject state;
    if(auto* p=pages.value("migrationStatus"))state["migration"]=migrationStatusSaveState(p);
    if(auto* p=qobject_cast<AiSettingsPage*>(pages.value("aiSettings")))state["ai"]=p->saveState();
    if(!state.isEmpty()){
      const auto path=QFileInfo(businessStore->filePath()).absolutePath()+"/settings-readers-v33.json";
      QFile previous(path);if(previous.open(QIODevice::ReadOnly)&&previous.size()<=26*1024*1024){auto old=QJsonDocument::fromJson(previous.readAll()).object();for(auto i=old.begin();i!=old.end();++i)if(!state.contains(i.key()))state[i.key()]=i.value();}
      QSaveFile file(path);auto bytes=QJsonDocument(state).toJson(QJsonDocument::Compact);
      business::require(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"设置阅读状态未保存；业务数据未改动");
    }
  }
  if (settings) {
    settings->setValue("layout", mode);
    settings->setValue("instrument", activeId);
    settings->setValue("dark", dark);
    settings->setValue("dualCharts", dualCharts);
    if(auto* p=qobject_cast<DataSourceStatusPage*>(pages.value("dataSourceStatus")))settings->setValue("dataSourceStatus/state",QJsonDocument(p->saveState()).toJson(QJsonDocument::Compact));
    if (auto* sector = qobject_cast<SectorWatchPage*>(pages.value("sectorWatch")))
      settings->setValue("sectorWatch/state", QJsonDocument(sector->saveState()).toJson(QJsonDocument::Compact));
    if (auto* leaders = qobject_cast<SectorLeaderPage*>(pages.value("sectorLeaders")))
      settings->setValue("sectorLeaders/state", QJsonDocument(leaders->saveState()).toJson(QJsonDocument::Compact));
    if (auto* news = qobject_cast<NewsPage*>(pages.value("news")))
      settings->setValue("news/state", QJsonDocument(news->saveState()).toJson(QJsonDocument::Compact));
    if (auto* discovery = qobject_cast<IndustryDiscoveryPage*>(pages.value("industryDiscovery")))
      settings->setValue("industryDiscovery/state", QJsonDocument(discovery->saveState()).toJson(QJsonDocument::Compact));
    settings->sync();
    business::require(settings->status()==QSettings::NoError,"设置或草稿未保存，窗口未退出；请检查存储位置后重试");
  }
  return true;
 }catch(const std::exception& e){statusBar()->showMessage(QString::fromUtf8(e.what()));return false;}
}
void Window::fillStocks() {
  const auto quoteTheme = appearance::theme(themeId);
  int sorted = stocks->horizontalHeader()->sortIndicatorSection();
  Qt::SortOrder order = stocks->horizontalHeader()->sortIndicatorOrder();
  stocks->setSortingEnabled(false);
  stocks->setRowCount(0);
  auto directory=liveQuoteRefresh?property("watchlistQuoteDirectory").toJsonObject():QJsonObject{};
  if(directory.isEmpty())directory=watchlistBridgeDirectory();
  // Quotes and text filtering reuse the validated directory. Group, roster
  // and edit actions still read and validate the current store.
  if(!liveQuoteRefresh)setProperty("watchlistQuoteDirectory",directory);
  QString group=directory.value("selectedName").toString(),query=search->text().trimmed();
  QJsonArray visibleInstruments;
  for (auto v : instruments) {
    auto s = v.toObject();
    QString id = s["id"].toString(), name = s["name"].toString();
    const bool observed=id==property("pinObservedInstrument").toString();
    if (s["transient"].toBool()&&!observed) continue;
    if (!observed&&settings && !settings->value("watch/" + id, true).toBool()) continue;
    if (!observed&&!watchlistHostAdapter::includes(directory,id)) continue;
    if (!query.isEmpty() && !name.contains(query) && !id.contains(query))
      continue;
    visibleInstruments.append(s);
    auto a = s["day"].toArray();
    auto last = displayedQuote(s, testing);
    double price = marketdata::value(last, "price"),
           prev = marketdata::value(last, "previousClose"),
           pct = marketdata::value(last, "changePercent");
    int r = stocks->rowCount();
    stocks->insertRow(r);
    auto* label = new QTableWidgetItem(name + "\n" + id.section(':', 2));
    label->setData(Qt::UserRole, id);
    label->setToolTip(name + " · " + id +
                      (testing ? "" : "\n" + dataLabel(s, "day")));
    stocks->setItem(r, 0, label);
    const int precision = pricePrecision(s);
    stocks->setItem(r, 1, new NumericItem(shortValue(price, precision), price));
    stocks->setItem(
        r, 2,
        new NumericItem(QString(pct >= 0 ? "+" : "") + shortValue(pct, 2) +
                            (std::isfinite(pct) ? "%" : ""),
                        pct));
    stocks->setItem(r, 3,
                    new NumericItem(QString(price >= prev ? "+" : "") +
                                        shortValue(price - prev, precision),
                                    price - prev));
    auto* spark = new QTableWidgetItem;
    QVariantList points;
    for (int n = std::max(0, int(a.size()) - 24); n < a.size(); ++n)
      points << a[n].toObject()["close"].toDouble();
    spark->setData(Qt::UserRole, points);
    stocks->setItem(r, 4, spark);
    int column = 5;
    for (const QString& key :
         {QString("open"), QString("high"), QString("low")}) {
      double val = marketdata::value(last, key);
      stocks->setItem(r, column++,
                      new NumericItem(shortValue(val, precision), val));
    }
    double volume = marketdata::value(last, "amount");
    if (testing) volume = marketdata::value(last, "volume");
    stocks->setItem(r, 8,
                    new NumericItem(shortValue(volume / 10000., 2) +
                                        (std::isfinite(volume) ? "万" : ""),
                                    volume));
    stocks->setItem(r, 9, new NumericItem(shortValue(prev, precision), prev));
    for (int c = 1; c < 10; c++) {
      stocks->item(r, c)->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
      if (c <= 4)
        stocks->item(r, c)->setForeground(quoteForeground(quoteTheme, pct));
    }
  }
  if(publicMarketRuntime)publicMarketRuntime->setVisibleStocks(visibleInstruments);
  context->setText(QString("%1 · %2 只%3")
                       .arg(group)
                       .arg(stocks->rowCount())
                       .arg(testing ? "示例标的" : "自选"));
  if (!testing) {
    stocks->horizontalHeaderItem(8)->setText("成交额(元)");
    int count = 0;
    for (auto item : instruments)
      if (std::isfinite(
              marketdata::value(item.toObject()["quote"].toObject(), "price")))
        ++count;
    dataState->setText(
        QString("报价 %1/%2").arg(count).arg(instruments.size()));
    dataState->setToolTip("本机自选及明确打开的临时观察标的；查看不会自动加入自选。报价时间见标的快照。" +
                          (feed ? feed->lastError : ""));
  }
  stocks->setSortingEnabled(true);
  if (sorted >= 0) stocks->sortItems(sorted, order);
  for (int r = 0; r < stocks->rowCount(); ++r)
    if (stocks->item(r, 0)->data(Qt::UserRole).toString() == activeId)
      stocks->selectRow(r);
}
void Window::loadChart(Chart* c, const QString& p, bool reset) {
  auto a = instrument[p].toArray();
  auto plotMeta=instrument[p+"Meta"].toObject();plotMeta.remove("requestState");
  const QJsonObject input{{"id",instrument["id"]},{"period",p},{"rows",a},
      {"meta",plotMeta},{"minuteMeta",instrument["minuteMeta"]},
      {"previousClose",instrument["previousClose"]},{"precision",pricePrecision(instrument)},{"testing",testing}};
  const bool unchanged=!reset&&c->property("stockSeriesInput").toJsonObject()==input;
  c->setProperty("stockSeriesInput",input);
  std::vector<market::Bar> bars;
  QStringList dates;
  for (auto v : a) {
    auto b = v.toObject();
    bars.push_back({marketdata::value(b, "time"), marketdata::value(b, "open"),
                    marketdata::value(b, "high"), marketdata::value(b, "low"),
                    marketdata::value(b, "close"),
                    marketdata::value(b, "volume"), b["valid"].toBool(),
                    b["closed"].toBool(),
                    !p.startsWith("minute") &&
                        instrument[p+"Meta"].toObject()["adjustment"] == "qfq"});
    dates << b["label"].toString();
  }
  c->periodName = p == "minute"      ? "分时"
                  : p == "minute5s"  ? "分时 · 5秒汇总"
                  : p == "minute30s" ? "分时 · 30秒汇总"
                  : p == "week"      ? "周K · 同标的参考"
                  : p == "month"     ? "月K"
                  : p == "year"      ? "年K · 月线汇总"
                                     : "日K";
  c->previousClose =
      testing
          ? instrument["previousClose"].toDouble()
          : marketdata::value(
                instrument[(p.startsWith("minute") ? p : QString("minute")) +
                           "Meta"]
                    .toObject(),
                "previousClose");
  c->priceDecimals = pricePrecision(instrument);
  const bool seconds=p=="minute5s"||p=="minute30s";
  const auto date=instrument[p+"Meta"].toObject()["dataDate"].toString(
      instrument["quote"].toObject()["tradeDate"].toString());
  const auto name=instrument["name"].toString();
  const auto requestMeta=instrument[p+"Meta"].toObject();
  const bool loading=requestMeta["requestState"]=="loading";
  const bool failed=requestMeta["requestState"]=="failed"||!requestMeta["error"].toString().isEmpty();
  c->findChild<QLabel*>("chartEmptyMessage")->setText(name.isEmpty()?QString("请选择证券"):
      loading?name+" · 正在载入"+c->periodName+"…":
      failed?name+" · 本次更新未完成，可刷新重试\n"+requestMeta["error"].toString():
      seconds?QString("%1\n%2来源尚未返回%3秒数据\n可查看1分钟分时或已有秒级历史")
          .arg(name,date.isEmpty()?QString():date+" · ",p=="minute5s"?"5":"30"):
          name+" · "+c->periodName+"暂无数据，请刷新重试");
  c->findChild<QWidget*>("chartEmptyActions")->setVisible(seconds&&!loading);
  c->volumeLabel = testing ? "成交量 · 模拟股数" : "成交量 · 手（来源口径）";
  if (p == "minute5s" || p == "minute30s")
    c->volumeLabel = instrument[p+"Meta"].toObject()["provider"]=="tencent-public-detail"?"成交量暂不可用":"已观测相邻快照成交增量 · 股 · 缺口不归桶";
  c->annotationRows=a;c->annotationMeta=instrument[p+"Meta"].toObject();c->annotationMeta["hostInstrumentId"]=instrument["id"];c->annotationMeta["hostPeriod"]=p;if(!c->annotationMeta.contains("instrumentId"))c->annotationMeta["instrumentId"]=instrument["id"];if(!c->annotationMeta.contains("period"))c->annotationMeta["period"]=p;
  c->vwapRows=a;c->vwapMeta=instrument[p+"Meta"].toObject();c->vwapPeriod=p;
  if(!unchanged)c->setSeries(bars, dates, p.startsWith("minute"), reset);
}
void Window::loadInstrument(const QString& id, bool reset) {
  if(!legacyHighFrequencyFrame.isEmpty()){activeId=legacyHighFrequencyFrame["id"].toString();statusBar()->showMessage("旧历史仍在主图；请先明确返回当前资料再切换证券。",8000);return;}
  QJsonObject requested;
  for (auto v : instruments)
    if (v.toObject()["id"].toString() == id) requested = v.toObject();
  if (requested.isEmpty()) return; // Never show the last stock under another id.
  if(feed&&id!=activeId)feed->cancelSamples();
  const bool keepReference = !reset && id == activeId &&
                             inspectedChart == referenceChart &&
                             referenceChart->isVisible();
  instrument = requested;
  activeId = id;
  if(reset){setProperty("pinObservedInstrument",id);if(!unifiedSearchOpen){QSignalBlocker block(search);search->clear();}fillStocks();}
  loadChart(chart, period, reset);
  loadChart(referenceChart, "week", reset);
  auto last = displayedQuote(instrument, testing);
  const double prev = marketdata::value(last, "previousClose");
  quote->setText(quoteSummaryHtml(instrument, last, testing,
                                appearance::theme(themeId)));
  quote->setToolTip(
      testing
          ? "设计模拟"
          : dataLabel(instrument, period) + "\n取得时间 " +
                instrument[period + "Meta"].toObject()["checkedAt"].toString());
  snapshot->setText(
      QString("<table cellspacing='4'><tr><td>代码</td><td>%1</td></tr>"
              "<tr><td>今开 / 昨收</td><td>%2 / %5</td></tr>"
              "<tr><td>最高 / 最低</td><td>%3 / %4</td></tr>"
              "<tr><td>成交额</td><td>%6 万元</td></tr></table>")
          .arg(id.section(':', 2), shortValue(marketdata::value(last, "open")),
               shortValue(marketdata::value(last, "high")),
               shortValue(marketdata::value(last, "low")), shortValue(prev),
               shortValue(marketdata::value(last, "amount") / 10000., 2)));
  bookState->setText(id.contains(":index:") ? "五档盘口 · 指数不适用"
                     : testing              ? "五档盘口 · 样本未提供"
                                            : "五档快照 · 股数");
  QString table = "<table width='100%' cellspacing='5'>";
  for (int n = 0; n < 10; ++n) {
    const bool sell = n < 5;
    const int level = sell ? 4 - n : n - 5;
    const auto rows = last[sell ? "asks" : "bids"].toArray();
    const auto row = !id.contains(":index:") && level < rows.size()
                         ? rows[level].toObject()
                         : QJsonObject{};
    table += QString(
                 "<tr><td>%1%2</td><td align='right'>%3</td><td "
                 "align='right'>%4</td></tr>")
                 .arg(sell ? "卖" : "买")
                 .arg(level + 1)
                 .arg(shortValue(marketdata::value(row, "price"),
                                 pricePrecision(instrument)),
                      shortValue(marketdata::value(row, "volume"), 0));
  }
  bookRows->setText(table + "</table>");
  for (int r = 0; r < stocks->rowCount(); ++r)
    if (stocks->item(r, 0)->data(Qt::UserRole).toString() == id)
      stocks->selectRow(r);
  if (keepReference)
    explainChart(referenceChart, referenceChart->selected);
  else
    showExplanation(chart->selected);
  if (feed && reset && !sourceEvidenceNavigation) {
    if(period=="minute5s"||period=="minute30s")feed->sample(id,period=="minute5s"?5:30);else feed->chart(id, period);
    feed->chart(id, "week");
  }
}
void Window::setPeriod(const QString& next) {
  if(!legacyHighFrequencyFrame.isEmpty()){if(auto* current=findChild<QPushButton*>(legacyHighFrequencyFrame.value("schema")=="quant-parquet-chart/v1"?"periodday":"periodminute"))current->setChecked(true);statusBar()->showMessage("旧历史日期与粒度保持；请先明确返回当前资料再切换周期。",8000);return;}
  period = next;
  samplingSeconds=next=="minute5s"?5:next=="minute30s"?30:0;
  if(auto* precision=findChild<QComboBox*>("minutePrecision")){QSignalBlocker block(precision);precision->setCurrentIndex(precision->findData(samplingSeconds));}
  if(feed)feed->cancelSamples();
  loadChart(chart, period, true);
  auto* b = findChild<QPushButton*>("period" + next);
  if (b) b->setChecked(true);
  showExplanation(chart->selected);
  if (feed && !activeId.isEmpty() && !sourceEvidenceNavigation){if(period=="minute5s"||period=="minute30s")feed->sample(activeId,period=="minute5s"?5:30);else feed->chart(activeId, period);}
}
void Window::setLayoutMode(const QString& next) {
  // Legacy analysis entry points now retain the single classic workbench.
  mode = next == "quotes" ? "quotes" : "classic";
  auto* b = findChild<QPushButton*>("layout" + mode);
  if (b) b->setChecked(true);
  arrangeWorkspace();
  save();
}
void Window::arrangeWorkspace() {
  if (!centerPanel) return;
  stocks->setVisible(!unifiedSearchOpen);if(unifiedSearchResults)unifiedSearchResults->setVisible(unifiedSearchOpen);
  const bool table = mode == "quotes";
  auto* detailsAction=findChild<QAction*>("showQuoteDetails");
  const bool detailsRequested=!detailsAction||detailsAction->isChecked();
  const bool detailsFit = width() >= 1340 && height() >= 800;
  const bool sideBook = mode == "classic" && detailsRequested && detailsFit;
  if(detailsAction){
    detailsAction->setEnabled(mode=="classic"&&detailsFit);
    detailsAction->setToolTip(!detailsFit?"窗口较小，调整至至少1340×800后可展开详情":"显示或收起右侧行情详情");
  }
  const bool linked = mode == "focus" && dualCharts && width() >= 1340 && legacyHighFrequencyFrame.isEmpty();
  auto* groupsAction=findChild<QAction*>("showWatchlistGroups");groupPanel->setVisible(groupsAction&&groupsAction->isChecked());
  centerPanel->setVisible(!table || width() >= 1250);
  signalPanel->setVisible(sideBook);
  focusFooter->setVisible(!table && !sideBook);
  indicatorRow->setVisible(!table);
  chartReadout->setWordWrap(true);
  for (const QString& name :
       {QString("overlay"), QString("nine"), QString("latest")})
    findChild<QPushButton*>(name)->setVisible(!table);
  openChartButton->setVisible(table);
  dualButton->setVisible(mode == "focus");
  indicatorChoices->hide();
  indicatorSelector->hide();
  dualButton->setEnabled(width() >= 1340);
  dualButton->setToolTip(
      "同一标的主周期 / 周K并列；窄屏保留单图，不重置历史位置");
  dualButton->setChecked(dualCharts);
  referenceChart->setVisible(linked);
  // Recompute splitter constraints after hiding a linked pane, before sizing
  // the outer workspace. Otherwise its previous two-chart minimum leaks into
  // the quote-preview width on the first switch.
  charts->refresh();
  centerPanel->layout()->invalidate();
  centerPanel->layout()->activate();
  if (!referenceChart->isVisible() && inspectedChart == referenceChart)
    showExplanation(chart->selected);
  charts->setOrientation(Qt::Horizontal);
  for (int c = 3; c < stocks->columnCount(); ++c)
    stocks->setColumnHidden(c, !table);
  stocks->verticalHeader()->setDefaultSectionSize(table ? 28 : 32);
  stocks->horizontalHeader()->setSectionResizeMode(QHeaderView::Interactive);
  stocks->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
  for (int c = 1; c < 10; ++c)
    stocks->setColumnWidth(c, c == 4 ? 96 : c == 8 ? 98 : table ? 82 : 70);
  if (table) {
    ui->body->setSizes({180, std::max(500, width() - 570), 360, 0});
  } else if (sideBook) {
    ui->body->setSizes({145, 280, std::max(550, width() - 657), 220});
  } else {
    ui->body->setSizes({145, 280, std::max(550, width() - 437), 0});
  }
  charts->setSizes({640, 640});
}
void Window::resizeEvent(QResizeEvent* e) {
  QMainWindow::resizeEvent(e);
  if (signalPanel) arrangeWorkspace();
}
void Window::returnToPreviousPage(){
  if(auto* capital=workspaceTabs->currentWidget()->findChild<QStackedWidget*>("capitalWorkbenchPages");capital&&capital->currentIndex()==1){capital->setCurrentIndex(0);return;}
  if(closeInternalReader())return;
  while(!pageHistory.isEmpty()){auto page=pageHistory.takeLast();if(page&&page!=workspaceTabs->currentWidget()){QScopedValueRollback<bool> guard(returningPage,true);activatePage(page);return;}}
  home();
}
bool Window::eventFilter(QObject* watched,QEvent* event){
  auto* widget=qobject_cast<QWidget*>(watched);
  if(widget&&widget->window()==this&&isVisible()){
    const bool backKey=event->type()==QEvent::KeyPress&&static_cast<QKeyEvent*>(event)->key()==Qt::Key_Backspace&&static_cast<QKeyEvent*>(event)->modifiers()==Qt::NoModifier;
    const bool mouseBack=event->type()==QEvent::MouseButtonRelease&&static_cast<QMouseEvent*>(event)->button()==Qt::BackButton;
    if(backKey||mouseBack){
      if(backKey)for(auto* edit=widget;edit&&edit!=this;edit=edit->parentWidget()){
        if(qobject_cast<QLineEdit*>(edit)||qobject_cast<QAbstractSpinBox*>(edit))return false;
        if(auto* text=qobject_cast<QTextEdit*>(edit);text&&!text->isReadOnly())return false;
        if(auto* text=qobject_cast<QPlainTextEdit*>(edit);text&&!text->isReadOnly())return false;
      }
      returnToPreviousPage();event->accept();return true;
    }
  }return QMainWindow::eventFilter(watched,event);
}
void Window::keyPressEvent(QKeyEvent* e) {
  if (e->key() == Qt::Key_Escape) {
    if (isFullScreen())
      showNormal();
    else if (closeInternalReader())
      return;
    else
      home();
    chart->setFocus();
  } else
    QMainWindow::keyPressEvent(e);
}
void Window::showExplanation(int i) { explainChart(chart, i); }
void Window::explainChart(Chart* source, int i) {
  inspectedChart = source;
  quote->setText(selectedQuoteHtml(instrument,source,i,testing,appearance::theme(themeId)));
  if (i < 0 || i >= int(source->bars.size())) {
    QString state = testing ? "暂无数据"
                            : dataLabel(instrument, source == referenceChart ? "week" : period);
    auto* message=source->findChild<QLabel*>("chartEmptyMessage");
    chartReadout->setText(message->text().section('\n',0,1).replace('\n'," · "));
    chartReadout->setToolTip({});
    signalSummary->setText("数据未就绪，不计算信号");
    footerSummary->setText(state);
    explanation->setPlainText("数据未就绪，不使用其他标的或模拟数据替代。\n" +
                              state);
    ui->statusLabel->setText(state);
    return;
  }
  auto& b = source->bars[i];
  auto& s = source->seq[i];
  QString html = QString("<h3>%1 · %2</h3><p>%3 · %4</p>")
                     .arg(instrument["name"].toString().toHtmlEscaped(),
                          source->labels.value(i), source->periodName,
                          !market::valid(b) ? "数据缺口 / 不可用"
                          : b.closed        ? "已收盘样本"
                                     : "形成中 · 不记确认信号");
  if (!market::valid(b)) {
    chartReadout->setText(source->labels.value(i) + "  数据缺口 · 不参与计算");
    chartReadout->setToolTip({});
    signalSummary->setText("数据缺口\n本根不可用，不形成信号。");
    footerSummary->setText(bookState->text() + "　｜　" +
                           source->labels.value(i) + "：数据缺口，不形成信号");
    explanation->setHtml(html +
                         "<p>数据缺口：本根不计算，不补零，不跨缺口连线。</p>");
    ui->statusLabel->setText((testing ? "设计模拟 · 非实时 | "
                                      : dataLabel(instrument, source == referenceChart ? "week" : period) + " | ") +
                             source->labels.value(i) + " | 数据缺口 / 不可用");
    return;
  }
  chartReadout->setText(QString("%1 · %2　开 %3　高 %4　低 %5　收 %6　｜　%7　%8")
                            .arg(source->periodName, source->labels.value(i),
                                 number(b.open), number(b.high), number(b.low),
                                 number(b.close), source->indicatorTitle(),
                                 source->indicatorValues(i)));
  chartReadout->setToolTip(chartReadout->text()+(source->vwapEnabled?"\n"+source->vwapText(i):""));
  html += QString(
              "<p>开 %1　高 %2<br>低 %3　收 %4</p><hr><h3>%5 · "
              "计算读数</h3><p>EMA(%6)　%7<br>%8</p>")
              .arg(number(b.open), number(b.high), number(b.low),
                   number(b.close), source->indicatorTitle().toHtmlEscaped())
              .arg(source->emaPeriod)
              .arg(number(source->overlayData[i]), source->indicatorValues(i).toHtmlEscaped());
  html+="<h3>关键位与历史事件</h3><p>"+source->annotationText(i).toHtmlEscaped().replace("\n","<br>")+"</p>";
  if(source->vwapEnabled)html+="<h3>VWAP 主图与口径</h3><p>"+source->vwapText(i).toHtmlEscaped().replace("\n","<br>")+"</p>";
  if (source->indicator == "MACD")
    html += QString(
                "<p>MACD(%1,%2,%3)<br>DIF %4<br>DEA %5<br>柱 = 2 × (DIF − "
                "DEA)<br>各线独立预热；未就绪的线不补零。</p>")
                .arg(source->macdFast)
                .arg(source->macdSlow)
                .arg(source->macdSignal)
                .arg(number(source->dif[i]), number(source->dea[i]));
  else if (source->indicator == "KDJ")
    html += QString("<h3>公式 · 旧版图表 KDJ(%1,3,3)</h3>"
                    "<p>RSV = (收盘−N根最低) / (N根最高−N根最低) × 100；平价窗口取50。"
                    "K = RSV/3 + 前K×2/3；D = K/3 + 前D×2/3；J = 3K−2D。"
                    "RSV、K、D、J逐步保留2位小数；K/D初值50，未满N根仅为初始化，"
                    "不作确认信号。J可以超出0–100，不截断。</p>").arg(source->kdjPeriod);
  else if (source->indicator == "RSI")
    html += QString("<h3>公式 · 旧版简单滚动 RSI(%1)</h3>"
                    "<p>最近N根上涨变化之和 / (上涨变化之和 + 下跌变化绝对值之和) × 100，"
                    "保留2位小数。每段首根变化按0；第N根起可用。全平价窗口按旧版取100。"
                    "这是简单滚动口径，不是Wilder平滑RSI。</p>").arg(source->rsiPeriod);
  else if (source->indicator == "CCI")
    html += QString("<h3>公式 · 旧版 CCI(%1)</h3>"
                    "<p>TP = (高 + 低 + 收)/3；MA = N根TP均值；MD = N根TP与MA差的绝对值均值。"
                    "TP、MA、MD各保留4位小数；CCI = (TP−MA)/(0.015×MD)，结果保留2位。"
                    "MD为0时取0；第N根起可用。±100为参考线，不是买卖指令。</p>").arg(source->cciPeriod);
  else if (source->indicator == "OBV")
    html += "<h3>公式 · 旧版 OBV</h3><p>每段首根取该根成交量；收盘高于前根加量，"
            "低于前根减量，相同则不变。累计范围为全载入历史，不随可见窗口缩放重置。"
            "无可调周期；单位沿用数据源成交量单位。缺失或负成交量不补0。</p>";
  if (source->indicator == "KDJ" || source->indicator == "RSI" ||
      source->indicator == "CCI" || source->indicator == "OBV")
    html += "<p>沿用输入K线的周期与复权状态，指标不另做复权。无效数据/溢出分段重新预热；"
            "形成中只预览，不延续为已确认信号。以下量能和九转是独立公共条件。</p>";
  html +=
      "<p>主图均线按本图周期的根数计算（周K的10根是10周），每线独立预热：</p>";
  for (int k = 0; k < source->maPeriods.size(); k++)
    html += QString("%1(%2) %3<br>")
                .arg(source->maType)
                .arg(source->maPeriods[k])
                .arg(number(source->maData[k][i]));
  html += "<hr><h3>当根条件与规则</h3>";
  if (source->indicator == "MACD" && i > 0 && std::isfinite(source->dif[i - 1]) &&
      std::isfinite(source->dea[i - 1])) {
    bool cross = source->dif[i] > source->dea[i] &&
                 source->dif[i - 1] <= source->dea[i - 1];
    html += QString("<p>MACD 上穿：%1<br>前根 DIF≤DEA 且本根 DIF&gt;DEA。</p>")
                .arg(cross ? "满足（不代表盈利）" : "未满足");
  }
  auto rv = market::rvol(source->bars, source->volumePeriod),
       ph = market::priorHigh(source->bars, 20);
  signalSummary->setText(
      QString("<p style='color:%7'>%1 · %2</p><p>相对量能　<b>%3 "
              "倍</b><br>20根突破　<b>%4</b><br>九转计数　<b>%5 / C%6</b></p>")
          .arg(source->labels.value(i), b.closed ? "已收盘" : "形成中",
               number(rv[i]),
               !std::isfinite(ph[i]) ? "样本不足"
               : b.close > ph[i]     ? "条件满足"
                                     : "未满足")
          .arg(s.setup)
          .arg(s.countdown)
          .arg(appearance::theme(themeId).accent.name()));
  footerSummary->setText(
      QString("%1　｜　%2 · %3\n%4：%5　相对量 %6　九转 %7 / C%8")
          .arg(bookState->text(), source->periodName,
               b.closed ? "已收盘样本" : "形成中 · 信号未确认",
               source->indicatorTitle(), source->indicatorValues(i), number(rv[i]))
          .arg(s.setup)
          .arg(s.countdown));
  html += QString(
              "<p>相对量能 %1 倍<br>当前量 / 前 %2 "
              "根均量（不含当前）。</p><p>前20根最高价 %3<br>严格突破：%4</p>")
              .arg(number(rv[i]))
              .arg(source->volumePeriod)
              .arg(number(ph[i]), !std::isfinite(ph[i]) ? "样本不足"
                                  : b.close > ph[i]     ? "条件满足"
                                                        : "未满足");
  html +=
      QString(
          "<h3>九转 · %1 / "
          "C%2%3</"
          "h3><p>"
          "严格价格翻转后，与前4根收盘连续比较计1–9；9后与前2根高低非连续比较计"
          "C1–C13。C13须通过对C8检验。</p><p>准备9确认：%4<br>C13确认：%5</p>")
          .arg(s.setup)
          .arg(s.countdown)
          .arg(s.deferred ? "+（延迟）" : "", s.setupTriggered ? "是" : "否",
               s.cdTriggered ? "是" : "否");
  html += QString("<p>TDST 支撑 %1（%2）<br>阻力 %3（%4）</p>")
              .arg(number(s.support),
                   !std::isfinite(s.support) ? "未形成"
                   : s.supportActive         ? "有效"
                                             : "已突破失效",
                   number(s.resistance),
                   !std::isfinite(s.resistance) ? "未形成"
                   : s.resistanceActive         ? "有效"
                                                : "已突破失效");
  for (const auto& event : s.events)
    html += "<p>" + QString(b.closed ? "当根事件：" : "预览事件（未确认）：") +
            eventLabel(event).toHtmlEscaped() + "</p>";
  html += "<hr><p>来源：" +
          (testing ? QString("内置设计模拟")
                   : dataLabel(instrument,
                               source == referenceChart ? "week" : period)
                         .toHtmlEscaped()) +
          "<br>口径：sequential-public-rules-v1<br>"
          "历史条件解释，不是买卖建议；未与付费产品逐根认证。</p>";
  explanation->setHtml(html);
  ui->statusLabel->setText(
      (testing
           ? QString("设计模拟 · 非实时  |  ")
           : dataLabel(instrument, source == referenceChart ? "week" : period) +
                 " | ") +
      QString("%1 %2  |  %3  |  %4")
          .arg(instrument["name"].toString(), source->labels.value(i),
               b.closed ? "已收盘样本" : "形成中",
               source->minute
                   ? "分时全天固定 · 单击/拖动读数 · Home回最新"
                   : "拖动看历史 · 滚轮缩放 · 单击读数 · Home回最新"));
}
QWidget* Window::businessPage(const QString& key, const QString& title,
                              const QString& workspace) {
  auto* page = new QWidget(workspaceTabs);
  page->setProperty("pageTitle", title);
  page->setProperty("workspace", workspace);
  pages.insert(key, page);
  workspaceTabs->addTab(page, title);
  return page;
}
void Window::legacyArchiveView(){
  auto* page=pages.value("legacyArchive");
  if(!page){page=new legacyArchive::Page(QFileInfo(businessStore->filePath()).absolutePath()+"/legacy-archive/webstock-snapshot.sqlite",workspaceTabs);
    page->setProperty("workspace","设置");page->setProperty("pageTitle","旧版数据 · 只读档案");pages["legacyArchive"]=page;auto* history=new QPushButton("旧5秒 / 30秒历史主图",page);history->setObjectName("openLegacyHighFrequencyArchive");page->layout()->addWidget(history);connect(history,&QPushButton::clicked,this,&Window::legacyHighFrequencyView);}
  activatePage(page);
}
void Window::activatePage(QWidget* page) {
  int index = workspaceTabs->indexOf(page);
  if (index < 0)
    index = workspaceTabs->addTab(page, page->property("pageTitle").toString());
  workspaceTabs->setCurrentIndex(index);
  syncNavigation();
  applyTheme();
}
bool Window::closeInternalReader() {
  if(workspaceTabs->currentWidget()->property("workbenchChild").toBool()){home();return true;}
  if(unifiedSearchOpen && workspaceTabs->currentWidget()==ui->body){closeUnifiedSearch();return true;}
  if(auto* research=pages.value("research");research&&workspaceTabs->currentWidget()==research)
    if(auto* creator=research->findChild<QWidget*>("creatorPage");creator&&creator->isVisible()&&creatorPageBack(creator))return true;
  if(auto*p=dynamic_cast<KnowledgeAiHostPage*>(workspaceTabs->currentWidget());p&&p->isVisible()&&!isMinimized()&&QGuiApplication::applicationState()==Qt::ApplicationActive&&p->back())return true;
  if(auto* host=pages.value("darkStocks");host&&workspaceTabs->currentWidget()==host)
    if(auto* view=host->findChild<DarkStockPage*>();view&&view->closeObservation())return true;
  if(auto* p=dynamic_cast<paperHost::Page*>(workspaceTabs->currentWidget());p&&p->back())return true;
  if(auto*host=pages.value("localCandidates");host&&host->isVisible())if(auto*p=host->findChild<LocalCandidatePage*>();p&&p->back())return true;
  if(auto*p=dynamic_cast<ArchiveVideoReviewPage*>(workspaceTabs->currentWidget()))p->back();
  if(auto*p=dynamic_cast<AccountEditPage*>(workspaceTabs->currentWidget()))if(p->back())return true;
  if(auto*p=dynamic_cast<cffexDisclosure::Page*>(pages.value("cffexDisclosure"));p&&p->isVisible()&&p->back())return true;
  if(auto*p=dynamic_cast<FuturesMonitorPage*>(pages.value("futuresMonitor"));p&&p->isVisible()&&p->back())return true;
  if(auto* p=dynamic_cast<WatchlistWorkspacePage*>(pages.value("watchlistWorkspace"));p&&p->isVisible()&&p->back())return true;
  if(auto* p=dynamic_cast<WatchlistReconciliationPage*>(pages.value("watchlistReconciliation"));p&&p->isVisible()&&p->back())return true;
  if(auto* p=pages.value("auctionAnalysis");p&&p->isVisible()&&auctionAnalysisBack(p))return true;
  if(auto* p=pages.value("materialLibrary");p&&p->isVisible()&&materialLibraryBack(p))return true;
  if(auto* p=dynamic_cast<PortfolioMirrorPage*>(pages.value("portfolioMirror"));p&&p->isVisible()&&p->back())return true;
  if(auto* p=pages.value("migrationStatus");p&&p->isVisible()&&migrationStatusBack(p))return true;
  if(auto* p=pages.value("sectorResearch");p&&p->isVisible()&&sectorResearchBack(p))return true;
  if (auto* p=dynamic_cast<QuantResearchPage*>(pages.value("quantResearch"));p&&p->isVisible()&&p->back())return true;
  if (auto* p = dynamic_cast<RiskSettingsPage*>(pages.value("riskSettings")); p && p->isVisible() && p->back()) return true;
  if (auto* p = pages.value("dataSafety"); p && p->isVisible() && dataSafetyBack(p)) return true;
  if (auto* p = pages.value("evidenceReview"); p && p->isVisible() && evidenceReviewBack(p)) return true;
  if (auto* p = dynamic_cast<PersonMethodPage*>(pages.value("personMethod")); p && p->isVisible() && p->back()) return true;
  auto* comments = findChild<QWidget*>("commentWorkshopPage");
  return comments && comments->isVisible() && commentWorkshopBack(comments);
}
void Window::home() {
  workspaceTabs->setCurrentWidget(ui->body);
  if(livePanePending){
    livePanePending=false;
    // Hidden quote updates do not change group membership. Roster/edit actions
    // already refresh the verified directory through syncLive(true).
    QScopedValueRollback<bool> quoteOnly(liveQuoteRefresh,true);
    fillStocks();loadInstrument(activeId,false);
  }
}
void Window::recordViewedInstrument() {
  if (instrument.isEmpty() || instrument["id"].toString() != activeId) return;
  try {
    auto viewed = instrument;
    if (testing) {
      auto sample = displayedQuote(viewed, true);
      sample["source"] = "模拟测试数据，非实时";
      viewed["quote"] = sample;
    }
    recentStore->recordView(viewed);
  } catch (const std::exception& e) {
    statusBar()->showMessage("最近查看未保存：" + QString::fromUtf8(e.what()), 10000);
  }
}
void Window::openRecentInstrument(const QString& id, bool analysis) {
  QJsonObject row;
  for (auto value : recentStore->list({}, "last_viewed", 10000))
    if (value.toObject()["id"] == id) row = value.toObject();
  if (row.isEmpty() || !row["canOpen"].toBool() ||
      !QRegularExpression("^(SH|SZ|BJ):(stock|index|etf):[0-9]{6}$").match(id).hasMatch())
    throw std::runtime_error("证券身份待核验，未打开行情");
  bool found = false;
  for (auto value : instruments)
    if (value.toObject()["id"] == id) found = true;
  if (!found) {
    if (feed) {
      feed->observe(row); // A view must not silently become a watchlist addition.
      instruments = feed->instruments;
    } else {
      row["transient"] = true;
      instruments.append(row);
    }
  }
  home();
  loadInstrument(id);
  if (mode == "quotes") setLayoutMode("focus");
  if (analysis) findChild<QPushButton*>("explain")->click();
  else recordViewedInstrument();
}
void Window::recentView() {
  auto* page = qobject_cast<RecentPage*>(pages.value("recent"));
  if (!page) {
    page = new RecentPage(recentStore, workspaceTabs);
    page->setProperty("workspace", "自选与账户");
    page->setProperty("pageTitle", "最近查看");
    pages["recent"] = page;
    connect(page,&RecentPage::backupRestoreRequested,this,[this,page]{if(!page->isVisible()||workspaceTabs->currentWidget()!=page)return;unifiedBackupView();if(auto* setup=pages.value("unifiedBackupSetup"))setup->setProperty("returnToRecent",true);});
    connect(page, &RecentPage::openRequested, this, [this, page](QString id, bool analysis) {
      try { openRecentInstrument(id, analysis); }
      catch (const std::exception& e) {
        page->findChild<QLabel*>("recentState")->setText(QString::fromUtf8(e.what()));
      }
    });
    connect(page, &RecentPage::watchlistRequested, this, [this, page](QJsonObject row) {
      auto* state = page->findChild<QLabel*>("recentState");
      try {
        const auto id = row["id"].toString();
        bool exists = false;
        for (auto value : instruments)
          if (value.toObject()["id"] == id && !value.toObject()["transient"].toBool()) exists = true;
        if (!exists && feed) {
          row["group"] = "默认分组";
          row["order"] = instruments.size();
          feed->add(row);
        } else if (!exists) {
          row.remove("transient");
          bool replaced = false;
          for (int n = 0; n < instruments.size(); ++n)
            if (instruments[n].toObject()["id"] == id) { instruments[n] = row; replaced = true; }
          if (!replaced) instruments.append(row);
        }
        if (settings) settings->setValue("watch/" + id, true);
        fillStocks();
        state->setText(exists ? "已在自选，已恢复列表显示。" : "已明确加入本机自选；未改动旧数据库。");
      } catch (const std::exception& e) { state->setText(QString::fromUtf8(e.what())); }
    });
    connect(page, &RecentPage::ledgerRequested, this, [this](QJsonObject row) {
      const auto id = row["id"].toString();
      if (id.contains(":index:")) return;
      accountView();
      auto* account = pages.value("accounts");
      try {
        preparePortfolioClose(account->findChild<QWidget*>("portfolioPage"));
      } catch (const std::exception& e) {
        const auto message="未预填最近查看标的："+QString::fromUtf8(e.what());
        account->findChild<QLabel*>("ledgerState")->setText(message);
        statusBar()->showMessage(message);
        return;
      }
      account->findChild<QPushButton*>("newTrade")->click();
      auto* symbols = account->findChild<QComboBox*>("tradeInstrument");
      if (symbols->findData(id) < 0) symbols->addItem(row["name"].toString()+" "+id, id);
      symbols->setCurrentIndex(symbols->findData(id));
      account->findChild<QLabel*>("ledgerState")->setText("已带入最近查看标的；请核对账本表单后保存，不会自动记账或下单。");
    });
    connect(page, &RecentPage::refreshQuotesRequested, this, [this, page] {
      if (!feed) {
        page->findChild<QLabel*>("recentState")->setText("模拟测试模式：没有发起网络请求。");
        return;
      }
      try {
        {
          QSignalBlocker batch(feed);
          for (auto value : recentStore->list({}, "last_viewed", 100)) {
            const auto row = value.toObject();
            if (row["canOpen"].toBool()) feed->observe(row);
          }
        }
        syncLive(true);
        feed->refreshQuotes();
        page->findChild<QLabel*>("recentState")->setText("正在按现有来源更新最近100条明确证券报价；未加入自选、未增加查看次数。");
      } catch (const std::exception& e) { page->findChild<QLabel*>("recentState")->setText(QString::fromUtf8(e.what())); }
    });
  }
  page->applyQuotes(instruments);
  activatePage(page);
}
void Window::paperMonitorView(){
  try{
    auto* page=dynamic_cast<paperHost::Page*>(pages.value("paperMonitor"));
    if(!page){
      const QString dir=QFileInfo(businessStore->filePath()).absolutePath()+"/paper-monitor-host";
      auto clock=[this]{if(testing&&paperMonitorTestNow)return paperMonitorTestNow();return QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);};
      auto flow=std::make_shared<paperHost::Flow>(paperHost::Flow::Host{
        [this,clock]{return paperHost::readSnapshot(businessStore->filePath(),instruments,clock,[this]{return !isVisible()||QGuiApplication::applicationState()!=Qt::ApplicationActive;});},clock
      },dir,QCoreApplication::applicationDirPath()+"/paper-session-2026-july-v1");
      page=new paperHost::Page(flow,workspaceTabs);page->setAutomationHost([this]{return aiSettings::Store(QFileInfo(businessStore->filePath()).absolutePath()+"/ai-settings-v1.sqlite").read().value("preferences").toObject();},[this](QJsonArray ids){if(!testing&&feed){feed->refreshQuotes();for(auto id:ids)feed->chart(id.toString(),"minute",true);}});page->setObjectName("paperMonitorHostPage");page->setProperty("workspace","模拟");page->setProperty("pageTitle","人工纸面监控");pages["paperMonitor"]=page;
      connect(qApp,&QGuiApplication::applicationStateChanged,page,[page](Qt::ApplicationState state){page->setActive(state==Qt::ApplicationActive&&page->isVisible());});
    }
    page->setDarkTheme(dark);activatePage(page);page->setActive(QGuiApplication::applicationState()==Qt::ApplicationActive);
  }catch(const std::exception&e){statusBar()->showMessage("纸面监控已阻断："+QString::fromUtf8(e.what()));}
}
void Window::accountView(bool paper) {
  QString key = paper ? "paper" : "accounts";
  if (auto* existing = pages.value(key)) {
    activatePage(existing);
    return;
  }
  auto* ledger = portfolioPage(
      businessStore, paper, [this] { return instruments; },
      [this](QString id) {
        home();
        loadInstrument(id);
        if (activeId == id) recordViewedInstrument();
      },
      workspaceTabs);
  auto* page = new QTabWidget(workspaceTabs);
  page->setObjectName(paper ? "paperWorkspace" : "accountWorkspace");
  page->addTab(ledger, "账户账本 / 手动流水");
  auto* analysis = new AccountAnalysisPage(businessStore, paper, [this] { return instruments; }, page);
  page->addTab(analysis, "资产结构 / 历史分析");
  connect(page, &QTabWidget::currentChanged, page, [ledger, analysis](int index) {
    if (index == 1) analysis->setAccount(ledger->findChild<QComboBox*>("ledgerAccount")->currentData().toString());
  });
  page->setProperty("workspace", paper ? "模拟" : "自选与账户");
  page->setProperty("pageTitle", paper ? "纸面模拟" : "账户账本");
  pages[key] = page;
  auto* recent = button("最近查看", paper ? "paperRecent" : "accountRecent", ledger);
  auto* shortcuts = new QHBoxLayout;
  shortcuts->addWidget(recent);
  auto* editAccount=button("账户资料 / 手工现金","accountOpenEditor",ledger);shortcuts->addWidget(editAccount);connect(editAccount,&QPushButton::clicked,this,[this]{accountEditView();});
  auto* referenceAccount=button("今日参考盈亏","accountOpenReference",ledger);shortcuts->addWidget(referenceAccount);connect(referenceAccount,&QPushButton::clicked,this,[this,ledger]{auto*choice=ledger->findChild<QComboBox*>("ledgerAccount");accountReferenceView(choice?choice->currentData().toString():QString());});
  auto* scenarios = button("情景测算 · 20工具", "openScenarioTools", ledger);
  shortcuts->addWidget(scenarios);
  if(paper){auto* monitor=button("人工纸面监控","paperOpenMonitor",ledger);shortcuts->addWidget(monitor);connect(monitor,&QPushButton::clicked,this,[this,monitor]{if(monitor->isVisible()&&isActiveWindow())paperMonitorView();});}
  if(!paper){
    auto* mirror=button("持仓镜像 / 只读对账","accountOpenMirror",ledger);shortcuts->addWidget(mirror);
    connect(mirror,&QPushButton::clicked,this,[this,ledger]{portfolioMirrorView(ledger->findChild<QComboBox*>("ledgerAccount")->currentData().toString());});
  }
  shortcuts->addStretch();
  qobject_cast<QVBoxLayout*>(ledger->layout())->insertLayout(0, shortcuts);
  connect(recent, &QPushButton::clicked, this, &Window::recentView);
  connect(scenarios, &QPushButton::clicked, this, &Window::scenarioToolsView);
  activatePage(page);
}
void Window::scenarioToolsView() {
  auto* page = pages.value("scenarioTools");
  if (!page) {
    page = new ScenarioToolsPage(
        QFileInfo(businessStore->filePath()).absolutePath() + "/scenario-drafts-v1.json", workspaceTabs);
    page->setProperty("workspace", "模拟");
    page->setProperty("pageTitle", "情景测算 / 20工具");
    pages["scenarioTools"] = page;
  }
  activatePage(page);
}
QJsonObject Window::portfolioMirrorInputs() const {
  QJsonArray accounts,ledgers,legacy,roster;QJsonObject quotes;
  for(auto value:instruments){auto row=value.toObject();const auto id=row.value("id").toString();
    business::require(QRegularExpression("^(SH|SZ|BJ):(stock|etf|index):[0-9]{6}$").match(id).hasMatch(),"持仓镜像需要完整证券身份");
    if(!row.contains("code"))row["code"]=id.section(':',2,2); // Exact full-ID projection, never a market guess.
    roster.append(row);quotes[id]=row.value("quote");}
  const auto trades=businessStore->read("trades");
  for(auto value:businessStore->read("accounts")){
    auto account=value.toObject();if(account.value("type")!="ledger")continue;accounts.append(account);
    ledgers.append(QJsonObject{{"accountId",account.value("id")},{"positions",business::portfolio(trades,quotes,account.value("id").toString()).value("positions")},
      {"positionsComplete",true},{"asOf",account.value("ledgerAsOf").toString()},{"basis","all-local-recorded-transactions"},
      {"sourceLabel","完整本机已记录流水；不证明券商全部持仓"},{"cashBalance",account.value("cashBalance").isDouble()?account.value("cashBalance"):QJsonValue(QJsonValue::Null)},
      {"cashAsOf",account.value("cashAsOf").toString()}});
  }
  for(auto value:businessStore->read("reports"))if(value.toObject().value("legacySource")=="portfolio_snapshots")legacy.append(value);
  return {{"accounts",accounts},{"ledgers",ledgers},{"instruments",roster},{"legacySnapshots",legacy},
    {"capturedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
    {"sourceLabel",testing?"隔离测试账本与报价，不是真实券商数据":"本机账本 / 已载入行情 / 已迁旧快照；捕获时间不是账本时点，不联网刷新"}};
}
void Window::portfolioMirrorView(const QString& account){
  try{
    auto* page=dynamic_cast<PortfolioMirrorPage*>(pages.value("portfolioMirror"));
    if(!page){
      auto store=std::make_shared<PortfolioMirrorStore>(QFileInfo(businessStore->filePath()).absolutePath()+"/portfolio-mirror-v1.sqlite");
      const QJsonObject initialContext{{"businessFile",businessStore->filePath()},{"instruments",instruments},{"isolated",testing}};
      page=new PortfolioMirrorPage(store,[this]{return portfolioMirrorInputs();},[this](QJsonObject row){openRiskInstrument(row);},workspaceTabs,initialContext);
      page->setObjectName("portfolioMirrorPage");page->setProperty("workspace","自选与账户");page->setProperty("pageTitle","持仓镜像 / 只读对账");pages["portfolioMirror"]=page;
    }
    if(!account.isEmpty()&&page->findChild<QComboBox*>("mirrorAccount")->currentData().toString()!=account)page->setAccount(account);page->setDarkTheme(dark);activatePage(page);
  }catch(const std::exception& e){statusBar()->showMessage("持仓镜像未打开；原账本保留："+QString::fromUtf8(e.what()));}
}
void Window::sectorWatchView() {
  auto* page = qobject_cast<SectorWatchPage*>(pages.value("sectorWatch"));
  if (!page) {
    page = new SectorWatchPage(
        QFileInfo(businessStore->filePath()).absolutePath() + "/sector-watch-v1.sqlite", !testing, workspaceTabs);
    page->setProperty("workspace", "自选与账户");
    page->setProperty("pageTitle", "板块观察 / 成分行情");
    pages["sectorWatch"] = page;
    page->findChild<Chart*>("sectorChart")->dark = dark;
    connect(page, &SectorWatchPage::observeInstrument, this, [this, page](QJsonObject input) {
      try {
        auto rows = marketdata::roster({{"schema", "native-watchlist/v1"}, {"instruments", QJsonArray{input}}});
        auto row = rows[0].toObject();
        const auto id = row["id"].toString();
        if (feed) {
          feed->observe(row);
          instruments = feed->instruments;
        } else {
          bool exists = false;
          for (auto value : instruments) if (value.toObject()["id"] == id) exists = true;
          if (!exists) { row["transient"] = true; instruments.append(row); }
        }
        for (auto value : instruments)
          if (value.toObject()["id"] == id) page->updateInstrument(value.toObject());
        // The member click requests its chart, without turning the board into a watchlist.
        if (feed) { feed->chart(id, "minute", true); feed->refreshQuotes(); }
      } catch (const std::exception& e) { page->setHostError(QString::fromUtf8(e.what())); }
    });
    connect(page, &SectorWatchPage::openInstrument, this, [this, page](const QString& id) {
      for (auto value : instruments) {
        if (value.toObject()["id"].toString() != id) continue;
        home();
        loadInstrument(id);
        if (mode == "quotes") setLayoutMode("focus");
        recordViewedInstrument();
        return;
      }
      page->setHostError("该成分证券尚未成功载入，请重新选择；未猜测市场代码。");
    });
    connect(page, &SectorWatchPage::addWatchlist, this, [this, page](QJsonObject input) {
      try {
        auto rows = marketdata::roster({{"schema", "native-watchlist/v1"}, {"instruments", QJsonArray{input}}});
        auto row = rows[0].toObject();
        const auto id = row["id"].toString();
        bool exists = false;
        for (auto value : instruments)
          if (value.toObject()["id"] == id && !value.toObject()["transient"].toBool()) exists = true;
        row["group"] = "默认分组";
        row["order"] = instruments.size();
        if (!exists && feed) { feed->add(row); instruments = feed->instruments; }
        else if (!exists) {
          row.remove("transient");
          bool replaced = false;
          for (int i = 0; i < instruments.size(); ++i)
            if (instruments[i].toObject()["id"] == id) { instruments[i] = row; replaced = true; }
          if (!replaced) instruments.append(row);
        }
        if (settings) settings->setValue("watch/" + id, true);
        fillStocks();
        page->setHostError(exists ? "已在本机自选，已恢复显示。" : "已明确加入本机自选；旧数据库未修改。");
      } catch (const std::exception& e) { page->setHostError(QString::fromUtf8(e.what())); }
    });
    if (feed) connect(feed, &MarketFeed::updated, page, [this, page](const QString& id) {
      for (auto value : feed->instruments)
        if (id.isEmpty() || value.toObject()["id"] == id) page->updateInstrument(value.toObject());
    });
    if (settings) {
      const auto state = QJsonDocument::fromJson(settings->value("sectorWatch/state").toByteArray()).object();
      if (!state.isEmpty()) page->restoreState(state);
    }
  }
  activatePage(page);
}
void Window::sectorLeadersView() {
  auto* page = qobject_cast<SectorLeaderPage*>(pages.value("sectorLeaders"));
  if (!page) {
    page = new SectorLeaderPage(QFileInfo(businessStore->filePath()).absolutePath() + "/sector-leaders-v1.sqlite", !testing, workspaceTabs);
    page->setObjectName("sectorLeaderPage");
    page->setProperty("workspace", "自选与账户");
    page->setProperty("pageTitle", "人工板块 / 龙头观察");
    pages["sectorLeaders"] = page;
    connect(page,&SectorLeaderPage::backupRestoreRequested,this,[this,page]{if(!page->isVisible()||workspaceTabs->currentWidget()!=page)return;unifiedBackupView();if(auto* setup=pages.value("unifiedBackupSetup"))setup->setProperty("returnToLeader",true);});
    page->setAvailableInstruments(instruments);
    connect(page, &SectorLeaderPage::observeInstrument, this, [this, page](QJsonObject input) {
      try {
        auto row = marketdata::roster({{"schema", "native-watchlist/v1"}, {"instruments", QJsonArray{input}}})[0].toObject();
        const auto id = row["id"].toString();
        if (feed) { feed->observe(row); instruments = feed->instruments; }
        else {
          bool exists = false;
          for (auto value : instruments) if (value.toObject()["id"] == id) exists = true;
          if (!exists) { row["transient"] = true; instruments.append(row); }
        }
        for (auto value : instruments) if (value.toObject()["id"] == id) page->updateInstrument(value.toObject());
        if (feed) feed->chart(id, "minute", false);
      } catch (const std::exception& e) { page->setHostError(QString::fromUtf8(e.what())); }
    });
    connect(page, &SectorLeaderPage::openInstrument, this, [this, page](const QString& id) {
      for (auto value : instruments) if (value.toObject()["id"] == id) {
        home(); loadInstrument(id);
        if (mode == "quotes") setLayoutMode("focus");
        recordViewedInstrument(); return;
      }
      page->setHostError("证券尚未载入临时观察；没有猜测市场或代码。");
    });
    connect(page, &SectorLeaderPage::addWatchlist, this, [this, page](QJsonObject input) {
      try {
        auto row = marketdata::roster({{"schema", "native-watchlist/v1"}, {"instruments", QJsonArray{input}}})[0].toObject();
        const auto id = row["id"].toString(); bool exists = false;
        for (auto value : instruments)
          if (value.toObject()["id"] == id && !value.toObject()["transient"].toBool()) exists = true;
        row["group"] = "默认分组"; row["order"] = instruments.size();
        if (!exists && feed) { feed->add(row); instruments = feed->instruments; }
        else if (!exists) {
          row.remove("transient"); bool replaced = false;
          for (int i = 0; i < instruments.size(); ++i)
            if (instruments[i].toObject()["id"] == id) { instruments[i] = row; replaced = true; }
          if (!replaced) instruments.append(row);
        }
        if (settings) settings->setValue("watch/" + id, true);
        fillStocks(); page->setAvailableInstruments(instruments);
        page->setHostError(exists ? "已在自选，恢复列表显示。" : "已明确加入本机自选；人工候选名单仍独立保存。");
      } catch (const std::exception& e) { page->setHostError(QString::fromUtf8(e.what())); }
    });
    if (feed) connect(feed, &MarketFeed::updated, page, [this, page](const QString& id) {
      for (auto value : feed->instruments)
        if (id.isEmpty() || value.toObject()["id"] == id) page->updateInstrument(value.toObject());
    });
    if (settings) {
      const auto state = QJsonDocument::fromJson(settings->value("sectorLeaders/state").toByteArray()).object();
      if (!state.isEmpty()) page->restoreState(state);
    }
  }
  for (auto* c : page->findChildren<Chart*>()) { c->dark = dark; c->update(); }
  activatePage(page);
}
void Window::newsView(bool selectCurrent) {
  auto* page = qobject_cast<NewsPage*>(pages.value("news"));
  if (!page) {
    page = new NewsPage(QFileInfo(businessStore->filePath()).absolutePath()+"/news-public-v1.sqlite",
        !testing, workspaceTabs);
    page->setProperty("workspace","研究");page->setProperty("pageTitle","市场资讯 / 公告档案");
    pages["news"]=page;
    connect(page, &NewsPage::openOriginal, this, [this,page](QString raw) {
      try {
        const auto target = publicNews::url(raw);
        business::require(!testing, "隔离检查不打开外部网站");
        business::require(QDesktopServices::openUrl(QUrl(target)), "系统未能打开原始来源");
      } catch(const std::exception& e) { page->setHostError(QString::fromUtf8(e.what())); }
    });
    if(settings) {
      auto state = QJsonDocument::fromJson(settings->value("news/state").toByteArray()).object();
      if(!state.isEmpty())page->restoreState(state);
    }
  }
  if(selectCurrent&&!instrument.isEmpty())page->setInstrument(instrument);
  activatePage(page);
}
void Window::stockResearchView(bool selectCurrent) {
  auto* page = dynamic_cast<StockResearchPage*>(pages.value("stockResearch"));
  if (!page) {
    auto store = std::make_shared<StockResearchStore>(
        QFileInfo(businessStore->filePath()).absolutePath() + "/stock-research-v1.sqlite", false);
    page = new StockResearchPage(store,
        {},
        [this](QJsonObject expected) { openResearchDocument(expected); },
        [this](QString id) {
          bool exists = false;
          for(auto value:instruments) if(value.toObject()["id"]==id) exists=true;
          business::require(exists, "该完整证券不在本机清单；未自动加自选或打开其他证券");
          home(); loadInstrument(id); recordViewedInstrument();
        }, workspaceTabs);
    page->setSnapshotReaderFactory([this,path=businessStore->filePath()]{
      const auto roster=instruments;
      return [path,roster](QString id){
        const auto source=nativeBusinessSourceRows(path,{"docs","relations"});
        return researchContext::snapshot(id,roster,source.value("docs").toArray(),source.value("relations").toArray());
      };
    });
    page->setProfileAccess(!testing);
    auto legacy = std::make_shared<SecuritiesLegacyStore>(
        QFileInfo(businessStore->filePath()).absolutePath() + "/securities-legacy-v1.sqlite");
    page->setLegacyProfileReader([legacy](QString id) { return legacy->profile(id); });
    page->setProperty("workspace","研究");page->setProperty("pageTitle","个股研究");
    pages["stockResearch"]=page;
  }
  if(selectCurrent&&!activeId.isEmpty()) page->setInstrument(activeId);
  activatePage(page);
}
void Window::researchView() {
  // Workspaces retain their internal pages, not a browser history stack.
  if (auto* page = pages.value("research")) {
    activatePage(page);
    return;
  }
  auto* page = researchPage(businessStore, workspaceTabs);
  auto wireIndustryRestore=[this,page]{if(auto* restore=page->findChild<QPushButton*>("industryReportRestore");restore&&!restore->property("hostWired").toBool()){
    restore->setProperty("hostWired",true);
    restore->setEnabled(true);connect(restore,&QPushButton::clicked,this,[this,page,restore]{
      if(pages.value("research")!=page||workspaceTabs->currentWidget()!=page||!page->isVisible()||!restore->isVisible()||!restore->isEnabled()||isMinimized()||!isActiveWindow()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return;
      unifiedBackupView();
    });
  }};
  connect(qobject_cast<QTabWidget*>(page),&QTabWidget::currentChanged,this,[wireIndustryRestore]{wireIndustryRestore();});
  wireIndustryRestore();
  auto* researchTabs = qobject_cast<QTabWidget*>(page);
  const SourceHandoffOpener opener = [this](const QString& kind, const QJsonObject& expected) {
    openHandoffSource(kind, expected);
  };
  auto addLazy=[this,researchTabs](QString title,std::function<QWidget*()> create){
    auto*host=new QWidget(researchTabs);auto*layout=new QVBoxLayout(host);layout->setContentsMargins(0,0,0,0);
    auto*error=new QLabel(host);error->setWordWrap(true);error->hide();layout->addWidget(error);
    int index=researchTabs->addTab(host,title);
    connect(researchTabs,&QTabWidget::currentChanged,host,[host,layout,error,index,create](int selected){
      if(selected!=index||host->property("loaded").toBool())return;
      try{auto*child=create();layout->addWidget(child);error->hide();host->setProperty("loaded",true);}
      catch(const std::exception&e){error->setText(QString::fromUtf8(e.what()));error->show();}
    });
  };
  addLazy("本机分析材料",[=]{return sourceAnalysisPage(businessStore,researchTabs,opener);});
  addLazy("交接历史",[=]{return sourceHandoffPage(businessStore,researchTabs,opener);});
  addLazy("历史研究报告",[=]{return new ResearchRunsPage(businessStore,researchTabs);});
  addLazy("研究编排 / 整批导入",[this,researchTabs]{return new ResearchWorkbenchPage(businessStore->filePath(),[this]{
    auto directory=QFileInfo(businessStore->filePath()).absolutePath();localCandidate::Store candidates(directory+"/local-candidates-v1.sqlite");
    auto saved=candidates.list();QJsonObject selected;if(!saved.isEmpty())selected=candidates.read(saved[0].toObject().value("id").toString());
    return researchWorkbench::hostContext(portfolioMirrorInputs(),selected,publicNews::Store(directory+"/news-public-v1.sqlite").archive(),researchModelSources::read(directory+"/quant-research-v1.json"));
  },researchTabs);});
  addLazy("评论工坊",[=]{return commentWorkshopPage(businessStore,researchTabs,opener);});
  page->setProperty("workspace", "研究");
  page->setProperty("pageTitle", "研究资料 / 证据");
  pages["research"] = page;
  auto* entries = new QWidget(page);
  auto* entryLayout = new QHBoxLayout(entries);entryLayout->setContentsMargins(0,0,0,0);
  auto* publicDetailsEntry=button("历史公开价格详情", "researchOpenPublicPriceDetails", entries);entryLayout->addWidget(publicDetailsEntry);
  connect(publicDetailsEntry,&QPushButton::clicked,this,&Window::publicPriceDetailView);
  auto* topicUpdate=button("产业主题更新","researchOpenIndustryTopic",entries);entryLayout->addWidget(topicUpdate);
  connect(topicUpdate,&QPushButton::clicked,this,[this,page,topicUpdate]{if(workspaceTabs->currentWidget()==page&&page->isVisible()&&topicUpdate->isVisible()&&!isMinimized()&&isActiveWindow()&&QGuiApplication::applicationState()==Qt::ApplicationActive)industryTopicView();});
  auto* stock = button("当前个股研究", "researchOpenStock", entries);
  auto* library=button("全量资料库","researchOpenLibrary",entries);entryLayout->addWidget(library);
  auto* knowledge=button("资料研究请求","researchOpenKnowledgeAi",entries);entryLayout->addWidget(knowledge);
  connect(knowledge,&QPushButton::clicked,this,[this,page,knowledge]{
    if(workspaceTabs->currentWidget()!=page||!knowledge->isVisible()||isMinimized()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return;
    knowledgeAiHostView();
  });
  connect(library,&QPushButton::clicked,this,&Window::materialLibraryView);
  entryLayout->addWidget(stock);
  connect(stock, &QPushButton::clicked, this, [this] { stockResearchView(); });
  auto* news = button("个股资讯", "researchOpenNews", entries);entryLayout->addWidget(news);
  connect(news, &QPushButton::clicked, this, [this] { newsView(true); });
  auto* methods = button("人物与方法", "researchOpenMethods", entries);entryLayout->addWidget(methods);
  connect(methods, &QPushButton::clicked, this, [this] { personMethodView(); });
  auto* evidence = button("报告与候选复核", "researchOpenEvidence", entries);entryLayout->addWidget(evidence);
  connect(evidence, &QPushButton::clicked, this, [this] { evidenceReviewView(); });
  auto* discovery = button("概念发现", "researchOpenDiscovery", entries);entryLayout->addWidget(discovery);
  connect(discovery, &QPushButton::clicked, this, &Window::industryDiscoveryView);
  auto* quant=button("量化研究","researchOpenQuant",entries);entryLayout->addWidget(quant);
  connect(quant,&QPushButton::clicked,this,&Window::quantResearchView);
  auto* external=button("板块 / 产业研究","researchOpenSectorResearch",entries);entryLayout->addWidget(external);
  connect(external,&QPushButton::clicked,this,[this]{sectorResearchView();});
  auto* candidates = button("本地候选", "openLocalCandidates", entries);
  entryLayout->addWidget(candidates);
  researchTabs->setCornerWidget(entries, Qt::TopRightCorner);
  connect(candidates, &QPushButton::clicked, this, &Window::localCandidateView);
  activatePage(page);
}
QJsonArray Window::evidenceInstruments() const {
  QJsonArray rows;
  for (auto value : instruments) {
    const auto row = value.toObject();
    rows.append(QJsonObject{{"id",row.value("id")},{"name",row.value("name")}});
  }
  return rows;
}
void Window::evidenceInstrumentAction(const QString& action, const QJsonObject& expected) {
  business::require(action == "chart" || action == "watchlist", "不支持的候选操作");
  const auto id = expected.value("instrumentId").toString();
  QJsonObject item; int position = -1, matches = 0;
  for (int i = 0; i < instruments.size(); ++i) if (instruments[i].toObject().value("id") == id) {
    item = instruments[i].toObject(); position = i; ++matches;
  }
  business::require(matches == 1 && item.value("name") == expected.value("name"),
      "完整证券身份/名称已变化或不在本机目录；未打开其他证券或加入自选");
  if (action == "chart") {
    home(); loadInstrument(id); if (mode == "quotes") setLayoutMode("focus"); recordViewedInstrument(); return;
  }
  if (item.value("transient").toBool()) {
    item.remove("transient");item["group"] = "默认分组";item["order"] = instruments.size();
    if (feed) { feed->add(item);instruments = feed->instruments; }
    else instruments[position] = item;
  }
  if(settings)settings->setValue("watch/" + id, true);fillStocks();
  statusBar()->showMessage("已明确加入或恢复本机自选；候选仍为未独立核验研究材料。",10000);
}
void Window::evidenceReviewView() {
  auto* page = pages.value("evidenceReview");
  if (!page) {
    page = evidenceReviewPage(businessStore, workspaceTabs,
        [this] { return evidenceInstruments(); },
        [this](const QString& action,const QJsonObject& row) { evidenceInstrumentAction(action,row); },
        [this](const QString& kind,const QJsonObject& row) { openHandoffSource(kind,row); });
    page->setProperty("workspace","研究");page->setProperty("pageTitle","报告 / 引用 / 候选复核");
    page->setToolTip("身份目录为本机自选及本次已知临时观察，不代表全市场；导入和确认候选不自动加入自选。");
    pages["evidenceReview"] = page;
  }
  activatePage(page);
}
QJsonArray Window::personMethodVersions() const {
  return nativeBusinessVersions(businessStore->filePath());
}
void Window::openPersonMethodSource(const QJsonObject& expected) {
  personMethod::validateVersion(expected);
  business::require(expected.value("namespace") == "native-business", "来源空间不匹配；未打开其他记录");
  bool matched = false;
  for (const auto version : personMethodVersions())
    if (personMethod::canonical(version) == personMethod::canonical(expected)) { matched = true; break; }
  business::require(matched, "来源完整版本已变化或缺失；冻结原文仍可阅读，未按名称替换");
  const auto kind = expected.value("kind").toString();
  const auto record = expected.value("originalRecord").toObject();
  if (kind != "reports") { openHandoffSource(kind, record); return; }
  auto* page = pages.value("methodReport");
  if (!page) {
    page = businessPage("methodReport", "方法引用 / 完整研究报告", "研究");
    auto* layout = new QVBoxLayout(page);
    auto* reader = new QPlainTextEdit(page);reader->setReadOnly(true);reader->setObjectName("methodReportReader");
    layout->addWidget(reader);
  }
  page->findChild<QPlainTextEdit*>("methodReportReader")->setPlainText(
      "本机研究报告完整版本 · " + expected.value("id").toString() + "\n" +
      expected.value("fingerprint").toString() + "\n\n" + personMethod::body(record) +
      "\n\n完整原记录（不是在线AI执行结果）\n" + QString::fromUtf8(QJsonDocument(record).toJson(QJsonDocument::Indented)));
  activatePage(page);
}
void Window::personMethodView() {
  auto* page = dynamic_cast<PersonMethodPage*>(pages.value("personMethod"));
  if (!page) {
    auto store = std::make_shared<PersonMethodStore>(QFileInfo(businessStore->filePath()).absolutePath() + "/person-method-v1.sqlite",false);
    page = new PersonMethodPage(store, [path=businessStore->filePath()] { return nativeBusinessVersions(path); },
        [this](QJsonObject expected) { openPersonMethodSource(expected); }, workspaceTabs);
    page->setProperty("workspace", "研究");page->setProperty("pageTitle", "人物 / 书籍 / 方法版本库");
    pages["personMethod"] = page;
  }
  activatePage(page);
}
void Window::researchHistoryView(const QString& title) {
  researchView();
  auto* tabs = qobject_cast<QTabWidget*>(pages.value("research"));
  for (int i = 0; i < tabs->count(); ++i)
    if (tabs->tabText(i) == title) { tabs->setCurrentIndex(i); return; }
}
void Window::openHandoffSource(const QString& kind, const QJsonObject& expected) {
  if (kind == "docs") { openResearchDocument(expected); return; }
  business::require(kind == "collections", "不支持的原文类型；没有打开其他记录");
  if (!pages.contains("collection")) collectionView();
  auto* page = pages.value("collection");
  ::openCollectionDocument(page, expected);
  activatePage(page);
}
void Window::localCandidateView() {
  if (auto* existing = pages.value("localCandidates")) {
    activatePage(existing);
    return;
  }
  LocalCandidateHost host;
  const auto backgroundDirectory=QFileInfo(businessStore->filePath()).absolutePath();
  host.background=std::make_shared<candidateBackgroundHost::Host>(candidateBackgroundHost::Paths{businessStore->filePath(),backgroundDirectory+"/recent-v1.sqlite",backgroundDirectory+"/sector-leaders-v1.sqlite",backgroundDirectory+"/local-candidate-background-v2.sqlite"});
  host.existingData = [this] {
    QJsonArray roster;
    for (auto value : instruments) {
      const auto row = value.toObject();
      if (row["transient"].toBool()) continue;
      QJsonObject meta;
      for (const QString& key : {QString("id"), QString("name"), QString("group")})
        if (row.contains(key)) meta[key] = row[key];
      roster.append(meta);
    }
    return roster;
  };
  host.snapshot = [this](const QSet<QString>& selected) {
    if (selected.isEmpty() || selected.size() > 50)
      throw std::runtime_error("请明确选择1至50只，没有静默截取。");
    QJsonArray snapshot;
    for (auto value : instruments) {
      const auto row = value.toObject();
      if (row["transient"].toBool() || !selected.contains(row["id"].toString())) continue;
      QJsonObject copy;
      for (const QString& key : {QString("id"), QString("symbol"), QString("name"),
                                QString("group"), QString("quote"), QString("dayMeta")})
        if (row.contains(key)) copy[key] = row[key];
      QJsonArray bars;
      const auto day = row["day"].toArray();
      for (int n = std::max(0, int(day.size()) - 81); n < day.size(); ++n)
        bars.append(day[n]);
      copy["day"] = bars;
      snapshot.append(copy);
    }
    if (snapshot.size() != selected.size())
      throw std::runtime_error("自选范围已变化，请重读范围后计算；没有遗漏或补造标的。");
    return snapshot;
  };
  auto* page = businessPage("localCandidates", "本地候选 / 冻结解释", "研究");
  auto* layout = new QVBoxLayout(page);
  auto* candidates = new LocalCandidatePage(
      QFileInfo(businessStore->filePath()).absolutePath() + "/local-candidates-v1.sqlite", host, page);
  layout->addWidget(candidates);
  connect(candidates, &LocalCandidatePage::openInstrument, this, [this, candidates](const QString& id) {
    for (auto value : instruments) {
      const auto row = value.toObject();
      if (row["id"].toString() != id || row["transient"].toBool()) continue;
      home();
      loadInstrument(id);
      if (activeId == id) recordViewedInstrument();
      return;
    }
    candidates->findChild<QLabel*>("candidateState")->setText(
        "该历史证券已不在本机实际自选，未自动加入；请核对范围后再打开行情。");
  });
  activatePage(page);
}
void Window::openResearchDocument(const QJsonObject& expected) {
  auto* page = pages.value("research");
  if (!page) { researchView(); page = pages.value("research"); }
  ::openResearchDocument(page, expected);
  activatePage(page);
}
void Window::collectionView() {
  if(auto* page=pages.value("collection")) {activatePage(page);return;}
  auto* page=collectionPage(businessStore,workspaceTabs,collectionPipeline,
      [this](const QJsonObject& doc) { openResearchDocument(doc); },
      [this](const QJsonObject& row){archiveVideoView(row);});
  page->setProperty("workspace","采集");page->setProperty("pageTitle","采集 / 本机转写");
  pages["collection"]=page;activatePage(page);
}
void Window::settingsView() {
  if (auto* page = pages.value("settings")) {
    activatePage(page);
    return;
  }
  auto* page = businessSettingsPage(businessStore, workspaceTabs);
  auto* appearanceChoice=new QComboBox(page);appearanceChoice->setObjectName("appearanceTheme");
  appearanceChoice->setAccessibleName("界面配色");
  for(auto id:appearance::ids())appearanceChoice->addItem(appearance::theme(id).name,id);
  appearanceChoice->setCurrentIndex(appearanceChoice->findData(themeId));
  page->layout()->addWidget(new QLabel("界面配色",page));page->layout()->addWidget(appearanceChoice);
  connect(appearanceChoice,&QComboBox::currentIndexChanged,this,[this,appearanceChoice]{selectTheme(appearanceChoice->currentData().toString());});
  auto* migration=button("功能迁移总览 / 完整缺口","settingsOpenMigration",page);
  auto* sources=button("数据来源 / 时点 / 本机缓存证据","settingsOpenSources",page);page->layout()->addWidget(sources);
  connect(sources,&QPushButton::clicked,this,&Window::dataSourceStatusView);
  auto* ai=button("AI偏好 / 能力声明","settingsOpenAi",page);
  page->layout()->addWidget(migration);page->layout()->addWidget(ai);
  connect(migration,&QPushButton::clicked,this,[this]{migrationStatusView();});
  connect(ai,&QPushButton::clicked,this,[this]{aiSettingsView();});
  auto* risk = button("风险阈值 / 本地提醒", "settingsOpenRisk", page);
  page->layout()->addWidget(risk);
  connect(risk, &QPushButton::clicked, this, [this] { riskSettingsView(); });
  auto* safety = button("数据位置 / 安全核验", "settingsOpenSafety", page);
  page->layout()->addWidget(safety);
  connect(safety, &QPushButton::clicked, this, [this] { dataSafetyView(); });
  auto* unified = button("统一非敏感备份 / 逐项恢复", "settingsOpenUnifiedBackup", page);
  page->layout()->addWidget(unified);
  connect(unified, &QPushButton::clicked, this, [this] { unifiedBackupView(); });
  auto* navigation = button("导航显示 / 勾选与排序", "settingsOpenNavigation", page);
  page->layout()->addWidget(navigation);
  connect(navigation,&QPushButton::clicked,this,&Window::navigationSettingsView);
  auto* analysis = button("本机分析材料（手动交接，不自动上传）", "settingsOpenAnalysis", page);
  auto* handoff = button("本机交接历史 / 单独备份", "settingsOpenHandoff", page);
  page->layout()->addWidget(analysis);
  page->layout()->addWidget(handoff);
  connect(analysis, &QPushButton::clicked, this, [this] { researchHistoryView("本机分析材料"); });
  connect(handoff, &QPushButton::clicked, this, [this] { researchHistoryView("交接历史"); });
  page->setProperty("workspace", "设置");
  page->setProperty("pageTitle", "业务备份 / 恢复");
  pages["settings"] = page;
  activatePage(page);
}
QJsonObject Window::migrationSnapshot() const {
  QFile file(":/migration-status.json");business::require(file.open(QIODevice::ReadOnly),"随包迁移快照不可读");
  auto snapshot=migrationStatus::validate(QJsonDocument::fromJson(file.readAll()).object());
  snapshot["snapshotSource"]="随当前安装包冻结的审查表；不会联网更新，不代表全部迁移完成";
  return snapshot;
}
QJsonArray Window::materialLibrarySources() const {
 QJsonArray rows;
 for(auto kind:{"docs","collections"})for(auto value:businessStore->read(kind)){
  auto row=value.toObject();rows.append(QJsonObject{{"kind",kind},{"id",row.value("id")},{"row",row}});
 }
 return knowledgeLegacy::attach(rows,QFileInfo(businessStore->filePath()).absolutePath()+"/knowledge-legacy-v1.sqlite");
}
void Window::materialLibraryView(){
 try{
  auto* page=pages.value("materialLibrary");
  if(!page){
   page=materialLibraryPage(QFileInfo(businessStore->filePath()).absolutePath()+"/material-library-v1.sqlite",workspaceTabs,
    [path=businessStore->filePath()]{
     const auto snapshot=nativeBusinessSourceRows(path,{"docs","collections"});QJsonArray rows;
     for(auto kind:{"docs","collections"})for(auto value:snapshot.value(kind).toArray()){auto row=value.toObject();rows.append(QJsonObject{{"kind",kind},{"id",row.value("id")},{"row",row}});}
     return knowledgeLegacy::attach(rows,QFileInfo(path).absolutePath()+"/knowledge-legacy-v1.sqlite");
    },[this](const QString& kind,const QJsonObject& row){openHandoffSource(kind,row);});
   page->setObjectName("materialLibraryPage");page->setProperty("workspace","研究");page->setProperty("pageTitle","全量资料库 / 人工分类");pages["materialLibrary"]=page;
   auto* knowledge=button("资料研究请求 · 选择 / 预览 / 历史","libraryOpenKnowledgeAi",page);
   qobject_cast<QVBoxLayout*>(page->layout())->insertWidget(0,knowledge);
   connect(knowledge,&QPushButton::clicked,this,[this,page,knowledge]{
    if(workspaceTabs->currentWidget()!=page||!knowledge->isVisible()||isMinimized()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return;
    knowledgeAiHostView();
   });
  }
  activatePage(page);
 }catch(const std::exception& e){statusBar()->showMessage("资料库未打开；原始资料未修改："+QString::fromUtf8(e.what()));}
}
void Window::knowledgeAiHostView(){
 try{
  auto* page=dynamic_cast<KnowledgeAiHostPage*>(pages.value("knowledgeAiHost"));
  if(!page){
   const auto directory=QFileInfo(businessStore->filePath()).absolutePath();
   page=new KnowledgeAiHostPage(directory+"/knowledge-ai-host-v1",[this]{return materialLibrarySources();},
    [directory]{return aiSettings::Store(directory+"/ai-settings-v1.sqlite").read().value("preferences").toObject();},workspaceTabs);
   page->setProperty("workspace","研究");page->setProperty("pageTitle","资料研究请求 · 未就绪");pages["knowledgeAiHost"]=page;
   connect(qApp,&QGuiApplication::applicationStateChanged,page,[page](Qt::ApplicationState state){if(state!=Qt::ApplicationActive)page->cancel();});
  }
  activatePage(page);
 }catch(const std::exception&){statusBar()->showMessage("资料研究宿主未打开，私有原稿保留");}
}
namespace {
QJsonObject prepareDataSourceEvidence(const QJsonObject& input){
 auto adapted=dataSourceSnapshotAdapter::adapt(input),snapshot=adapted.value("snapshot").toObject();QJsonArray rows;
 for(auto value:snapshot.value("records").toArray()){
  auto r=value.toObject();auto t=r.value("target").toObject();auto product=r.value("product").toString();QString route;
  if(t.value("kind")=="instrument"){
   if(product=="quote"||product=="intraday"||product=="kline")route="detail";
   else if(product=="funds")route="capital";else if(product=="auction")route="auction";
  }else if(product=="news")route="news";
  else if(t.value("kind")=="market")route="market-overview";
  else if(product=="industry"||product=="concept")route="sector-watch";
  r["route"]=route;rows.append(r);
 }
 snapshot["records"]=rows;adapted["snapshot"]=dataSourceStatus::snapshot(snapshot);return adapted;
}
}
QJsonObject Window::dataSourceEvidenceInput() const {
 QJsonObject input{{"instruments",instruments},{"generatedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}};
 if(auto* p=qobject_cast<SectorWatchPage*>(pages.value("sectorWatch")))input["sectorSnapshots"]=p->sourceEvidence();
 if(auto* p=qobject_cast<MarketOverviewPage*>(pages.value("marketOverview")))input["marketSnapshots"]=QJsonArray{p->sourceEvidence()};
 if(auto* p=qobject_cast<NewsPage*>(pages.value("news")))input["newsSnapshots"]=QJsonArray{p->sourceEvidence()};
 return input;
}
QJsonObject Window::dataSourceEvidence() const {return prepareDataSourceEvidence(dataSourceEvidenceInput());}
void Window::openDataSourceTarget(const QString& route,const QJsonObject& target){
 bool exact=false;
 for(auto value:dataSourceEvidence().value("snapshot").toObject().value("records").toArray()){
  auto row=value.toObject();if(row.value("route")==route&&dataSourceStatus::navigation(row)==target)exact=true;
 }
 business::require(exact,"证据目标已不在本机快照；未猜测或打开其他标的");
 QScopedValueRollback<bool> noFetch(sourceEvidenceNavigation,true);
 if(target.value("kind")=="instrument"){
  const auto id=target.value("id").toString();home();
  if(route=="detail"){
   auto p=target.value("granularity").toString();if(QStringList{"day","week","month","year","minute","minute5s","minute30s"}.contains(p)){period=p;auto* b=findChild<QPushButton*>("period"+(p.startsWith("minute")?QString("minute"):p));if(b)b->setChecked(true);}
  }
  loadInstrument(id);
  business::require(activeId==id,"完整证券身份未匹配");
  if(route=="capital"){
   funds();auto* symbols=pages.value("funds")->findChild<QComboBox*>("fundSymbols");int index=symbols->findData(id);business::require(index>=0,"资金页无此完整身份");symbols->setCurrentIndex(index);
   auto* modes=pages.value("funds")->findChild<QComboBox*>("fundMode");auto grain=target.value("granularity").toString();modes->setCurrentIndex(modes->findData(grain));
  }else if(route=="auction")auctionView();
 }else if(route=="news")newsView(false);
 else if(route=="market-overview")marketOverviewView();
 else if(route=="sector-watch"){
  sectorWatchView();auto* p=qobject_cast<SectorWatchPage*>(pages.value("sectorWatch"));business::require(p,"板块入口不可用");
  auto s=p->saveState();auto provider=target.value("sourceProvider").toString();s["provider"]=provider.startsWith("sina-public-")?"sina":provider;
  s["taxonomy"]=target.value("product");s["boardFilter"]=target.value("code").toString();s["filter"]="";
  s["boardKey"]=target.value("kind")=="board"?sectorWatch::queryKey(sectorWatch::query(target.value("provider").toString(),target.value("taxonomy").toString(),target.value("code").toString())):QString{};
  p->restoreState(s);
 }
}
void Window::dataSourceStatusView(){
 try{
  auto* page=qobject_cast<DataSourceStatusPage*>(pages.value("dataSourceStatus"));
  if(!page){
   page=new DataSourceStatusPage(workspaceTabs);page->setProperty("workspace","设置");page->setProperty("pageTitle","本机数据来源 / 时点");pages["dataSourceStatus"]=page;
   page->setAllowedRoutes({"detail","capital","auction","sector-watch","market-overview","news"});
   if(settings)page->setProperty("restoreState",QJsonDocument::fromJson(settings->value("dataSourceStatus/state").toByteArray()).object());
   auto* reload=button("重读已持有证据（不请求数据源）","dataSourceReload",page);page->layout()->addWidget(reload);
   connect(reload,&QPushButton::clicked,this,&Window::dataSourceStatusView);
   connect(page,&DataSourceStatusPage::openNative,this,[this,page](QString route,QJsonObject target){try{if(page->isVisible())openDataSourceTarget(route,target);}catch(...){page->setHostError({});}});
  }
  const auto input=dataSourceEvidenceInput();page->requestSnapshot([input]{return prepareDataSourceEvidence(input);});
  activatePage(page);
 }catch(const std::exception&){statusBar()->showMessage("来源证据未更新；已有记录保留，未请求外部接口。");}
}
QString Window::migrationTarget(const QString& id,const QString& route) const {
  const QHash<QString,QString> allowed{{"D27|health","sources"},{"P016|","library"},{"A16|reader","library"},{"A20|migration","migration"},{"A28|ai-settings","ai"},{"P034|","ai"},{"P042|","ai"},
    {"D01|dashboard","overview"},{"D03|sectors","sectors"},{"D06|watchlist","home"},{"D08|recent","recent"},
    {"D07|portfolio","mirror"},{"D09|trades","account"},{"D10|stats","account"},{"D13|rotation","rotation"},{"D15|capitalDaily","etf"},
    {"D17|screener","candidate"},{"D18|news","news"},{"D19|aiResearch","runs"},{"D22|aiHistory","handoff"},
    {"D23|creatorTasks","collection"},{"D24|compoundLab","scenario"},{"D25|paperPortfolio","paper"},{"D26|settings","settings"}};
  for(auto v:migrationSnapshot().value("entries").toArray()){auto e=v.toObject();if(e.value("id")==id&&e.value("route").toString()==route)return allowed.value(id+"|"+route);}
  return {};
}
void Window::openMigrationTarget(const QString& id,const QString& route){
  const auto target=migrationTarget(id,route);business::require(!target.isEmpty(),"不在已接入入口白名单；未按路径或名称猜测");
  if(target=="sources")dataSourceStatusView();else if(target=="library")materialLibraryView();else if(target=="migration")migrationStatusView();else if(target=="ai")aiSettingsView();else if(target=="overview")marketOverviewView();
  else if(target=="sectors")sectorWatchView();else if(target=="home")home();else if(target=="recent")recentView();
  else if(target=="mirror")portfolioMirrorView();else if(target=="account")accountView();else if(target=="rotation")rotation();else if(target=="etf")etfDailyView();
  else if(target=="candidate")localCandidateView();else if(target=="news")newsView();else if(target=="runs")researchHistoryView("历史研究报告");
  else if(target=="handoff")researchHistoryView("交接历史");else if(target=="collection")collectionView();
  else if(target=="scenario")scenarioToolsView();else if(target=="paper")accountView(true);else if(target=="settings")settingsView();
}
void Window::migrationStatusView(){
  try{
    auto* page=pages.value("migrationStatus");
    if(!page){
      page=migrationStatusPage(workspaceTabs,[this]{return migrationSnapshot();},[this](const QString& id,const QString& route){return !migrationTarget(id,route).isEmpty();},
        [this](const QString& id,const QString& route){openMigrationTarget(id,route);},[this](const QString& id,const QString& reference){
          for(auto v:migrationSnapshot().value("entries").toArray()){auto e=v.toObject();if(e.value("id")==id&&migrationStatus::references(e).contains(reference))
            return QJsonObject{{"source","安装包冻结审查表"},{"available",false},{"message","这里只携带证据引用和原始审查记录，未携带外部检查附件；不按引用字符串读取本机任意路径。"},{"text",QString::fromUtf8(QJsonDocument(e).toJson(QJsonDocument::Indented))}};}
          throw std::runtime_error("证据身份或引用不在随包白名单");return QJsonObject{};
        });
      page->setObjectName("migrationStatusPage");page->setProperty("workspace","设置");page->setProperty("pageTitle","功能迁移总览");pages["migrationStatus"]=page;
      QFile state(QFileInfo(businessStore->filePath()).absolutePath()+"/settings-readers-v33.json");if(state.open(QIODevice::ReadOnly)&&state.size()<=26*1024*1024)migrationStatusRestoreState(page,QJsonDocument::fromJson(state.readAll()).object().value("migration").toObject());
    }
    activatePage(page);
  }catch(const std::exception& e){statusBar()->showMessage(QString::fromUtf8(e.what()));}
}
void Window::aiSettingsView(){
  try{
    auto* page=qobject_cast<AiSettingsPage*>(pages.value("aiSettings"));
    if(!page){
      page=new AiSettingsPage(QFileInfo(businessStore->filePath()).absolutePath()+"/ai-settings-v1.sqlite",workspaceTabs);
      page->setProperty("workspace","设置");page->setProperty("pageTitle","AI偏好 / 能力声明");pages["aiSettings"]=page;page->setManualHandoffAvailable(true);
      connect(page,&AiSettingsPage::openManualHandoff,this,[this,page]{if(page->isVisible())researchHistoryView("本机分析材料");});
      connect(page,&AiSettingsPage::configurationSaved,this,[this](QJsonObject){statusBar()->showMessage("非敏感偏好已保存；未配置凭据，未授权或调用网络模型。",6000);});
      auto* choose=button("选择本机配置文件并安全预览","aiChooseFile",page);page->layout()->addWidget(choose);
      connect(choose,&QPushButton::clicked,page,[page]{auto path=QFileDialog::getOpenFileName(page,"安全预览非敏感配置",{},"JSON (*.json)");if(path.isEmpty())return;QFile f(path);if(!f.open(QIODevice::ReadOnly)||f.size()>1024*1024){page->setHostError("配置文件不可读或过大");return;}page->previewImport(f.readAll());});
      QFile state(QFileInfo(businessStore->filePath()).absolutePath()+"/settings-readers-v33.json");if(state.open(QIODevice::ReadOnly)&&state.size()<=26*1024*1024)page->restoreState(QJsonDocument::fromJson(state.readAll()).object().value("ai").toObject());
    }
    activatePage(page);
  }catch(const std::exception& e){statusBar()->showMessage("AI偏好未打开；本机数据保留。"+QString::fromUtf8(e.what()));}
}
QJsonObject Window::riskInputs() const {
  QJsonArray quotes, watch;
  for (auto value : instruments) {
    auto row = value.toObject();
    if (!row.value("quote").isObject()) row["quote"] = QJsonObject{};
    quotes.append(row);
    if (!row.value("transient").toBool() && (!settings || settings->value("watch/"+row.value("id").toString(),true).toBool())) watch.append(row);
  }
  sectorLeader::Store leaders(QFileInfo(businessStore->filePath()).absolutePath()+"/sector-leaders-v1.sqlite");
  return {{"accounts",businessStore->read("accounts")},{"trades",businessStore->read("trades")},
      {"quoteInstruments",quotes},{"watchlistInstruments",watch},{"leaderConfig",leaders.read()},
      {"capturedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
      {"sourceLabel",testing?"隔离测试数据，非实时行情":"本机账本 / 已载入行情 / 实际自选 / 人工龙头；仅读当前缓存，不自动刷新"}};
}
void Window::openRiskInstrument(const QJsonObject& expected) {
  QJsonObject row;int count=0;
  for(auto value:instruments) if(value.toObject().value("id")==expected.value("id")){row=value.toObject();++count;}
  business::require(count==1 && row.value("name")==expected.value("name"),"完整证券身份或名称已变化；未打开其他证券");
  home();loadInstrument(row.value("id").toString());if(mode=="quotes")setLayoutMode("focus");recordViewedInstrument();
}
void Window::riskSettingsView() {
  auto* page=dynamic_cast<RiskSettingsPage*>(pages.value("riskSettings"));
  if(!page){
    auto store=std::make_shared<RiskSettingsStore>(QFileInfo(businessStore->filePath()).absolutePath()+"/risk-settings-v1.json");
    page=new RiskSettingsPage(store,[this]{return riskInputs();},[this](QJsonObject row){openRiskInstrument(row);},[this]{statusBar()->showMessage("风险设置已保存，本机提醒已重算；未改变持仓或下单。",6000);},workspaceTabs);
    page->setProperty("workspace","设置");page->setProperty("pageTitle","风险阈值 / 本地提醒");pages["riskSettings"]=page;
  }
  page->setDarkTheme(dark);activatePage(page);
}
QJsonArray Window::dataSafetyInventory() const {
  const auto directory=QFileInfo(businessStore->filePath()).absolutePath();
  QJsonArray rows;
  auto add=[&](QString id,QString label,QString path,QString format,QJsonArray tables,bool included){
    rows.append(QJsonObject{{"id",id},{"role",id},{"label",label},{"path",path},{"format",format},{"tables",tables},{"backupIncluded",included},
        {"source","原生宿主明确位置；仅检查文件与安全表计数，不扫描目录、不读取记录正文；文件时间不是行情时间"}});
  };
  add("business","账户 / 研究 / 采集七类业务",businessStore->filePath(),"sqlite",{"records"},true);
  add("market","行情与自选快照 / K线缓存",directory+"/live/market-v1.sqlite","sqlite",{"snapshots","bars","series"},false);
  add("risk","本机风险阈值",directory+"/risk-settings-v1.json","file",{},false);
  add("recent","最近查看独立库",directory+"/recent-v1.sqlite","sqlite",{},false);
  add("leaders","人工龙头独立库",directory+"/sector-leaders-v1.sqlite","sqlite",{},false);
  return rows;
}
namespace {
QJsonArray readSectorResearchScopes(std::shared_ptr<BusinessStore> businessStore) {
  QJsonArray scopes;
  for(auto value:businessStore->read("topics")){
    const auto row=value.toObject();business::require(!row.value("id").toString().isEmpty()&&!row.value("name").toString().isEmpty(),"本机产业主题身份不完整，未猜测替换");
    scopes.append(QJsonObject{{"kind","industry"},{"id","business:topics:"+row.value("id").toString()},{"name",row.value("name")},
      {"source","本机产业主题原记录；不代表已核验成员或在线研究"},{"asOf",row.contains("asOf")?row.value("asOf"):QJsonValue(QJsonValue::Null)},
      {"cached",true},{"coverage","成员与月度热度未由主题名称推断"},{"snapshot",row}});
  }
  industryDiscovery::Store discovery(QFileInfo(businessStore->filePath()).absolutePath()+"/industry-discovery-v1.sqlite");
  for(auto value:discovery.read().value("topics").toArray()){
    const auto row=value.toObject();
    scopes.append(QJsonObject{{"kind","sector"},{"id","discovery:"+row.value("id").toString()},{"name",row.value("name")},
      {"source",row.value("provider")},{"asOf",row.value("sourceObservedAt")},{"cached",true},
      {"coverage","仅经手工确认的目录线索；没有成分/月度观测，在线AI未执行"},{"snapshot",row}});
  }
  return scopes;
}
}
QJsonArray Window::sectorResearchScopes() const {return readSectorResearchScopes(businessStore);}
void Window::sectorResearchView(const QString& kind,const QString& id){
  try{
  auto* page=pages.value("sectorResearch");
  if(!page){
    page=sectorResearchPage(businessStore,workspaceTabs,[store=businessStore]{return readSectorResearchScopes(store);},[this]{return evidenceInstruments();},
      [this](const QString& type,const QJsonObject& expected){openHandoffSource(type,expected);},
      [this](const QString& action,const QJsonObject& expected){auto value=expected;value["instrumentId"]=expected.value("id");evidenceInstrumentAction(action,value);});
    sectorResearchSetAiPreferences(page,[this]{return aiSettings::Store(QFileInfo(businessStore->filePath()).absolutePath()+"/ai-settings-v1.sqlite").read().value("preferences").toObject();});
    page->setObjectName("sectorResearchPage");page->setProperty("workspace","研究");page->setProperty("pageTitle","板块 / 产业外部研究");pages["sectorResearch"]=page;
  }
  if(!kind.isEmpty()||!id.isEmpty())business::require(sectorResearchSelectScope(page,kind,id),"完整主题不在本机清单；未按名称替换或自动保存");
  activatePage(page);
  }catch(const std::exception& e){statusBar()->showMessage("板块产业研究未打开："+QString::fromUtf8(e.what()));}
}
void Window::quantResearchView() { prepareQuantResearch(true); }
void Window::prepareQuantResearch(bool activate) {
  try{
  if(!activate){QFile config(QFileInfo(businessStore->filePath()).absolutePath()+"/quant-research-v1.json.model-jobs/settings.json");if(!config.open(QIODevice::ReadOnly)||config.size()>1024*1024)return;auto settings=QJsonDocument::fromJson(config.readAll());if(!settings.isObject()||!settings.object().value("dailyEnabled").toBool(false))return;}
  auto* page=dynamic_cast<QuantResearchPage*>(pages.value("quantResearch"));
  if(!page){
    auto store=std::make_shared<QuantResearchStore>(QFileInfo(businessStore->filePath()).absolutePath()+"/quant-research-v1.json",false);
    page=new QuantResearchPage(store,[path=businessStore->filePath()]{return nativeBusinessVersions(path);},[this](QJsonObject original){openPersonMethodSource(original);},workspaceTabs);
    page->setParquetChartOpener([this,page](QJsonObject packet){if(page->isVisible()&&workspaceTabs->currentWidget()==page&&!isMinimized())openLegacyHistoryPacket(packet);});
    page->setObjectName("quantResearchPage");page->setProperty("workspace","研究");page->setProperty("pageTitle","量化研究 / 历史模拟");pages["quantResearch"]=page;
  }
  if(activate)activatePage(page);else {page->prepareEnabledDailySchedule();page->hide();}
  }catch(const std::exception& e){statusBar()->showMessage("量化研究未打开："+QString::fromUtf8(e.what()));}
}
void Window::industryDiscoveryView() {
  auto* page=qobject_cast<IndustryDiscoveryPage*>(pages.value("industryDiscovery"));
  if(!page) {
    page=new IndustryDiscoveryPage(QFileInfo(businessStore->filePath()).absolutePath()+"/industry-discovery-v1.sqlite",!testing,workspaceTabs);
    page->setProperty("workspace","研究");page->setProperty("pageTitle","行业概念发现");pages["industryDiscovery"]=page;
    page->setMaterialsAvailable(true);
    connect(page,&IndustryDiscoveryPage::openMaterials,this,[this,page](QJsonObject expected){
      try{
        business::require(page->isVisible(),"已离开发现页，未自动打开研究");
        industryDiscovery::Store store(QFileInfo(businessStore->filePath()).absolutePath()+"/industry-discovery-v1.sqlite");bool exact=false;
        for(auto value:store.read().value("topics").toArray())if(value.toObject()==expected)exact=true;
        business::require(exact,"候选完整版本已变化，请重读；未用同名主题替代");
        sectorResearchView("sector","discovery:"+expected.value("id").toString());
      }catch(const std::exception& e){page->setHostError(QString::fromUtf8(e.what()));}
    });
    connect(page,&IndustryDiscoveryPage::openBoard,this,[this,page](QString provider,QString taxonomy,QString code){
      try {
        business::require(page->isVisible(),"已离开发现页面，未切换板块");
        const auto query=sectorWatch::query(provider,taxonomy,code);
        sectorWatchView();auto* target=qobject_cast<SectorWatchPage*>(pages.value("sectorWatch"));
        business::require(target,"板块观察入口不可用");
        auto state=target->saveState();state["provider"]=provider.startsWith("sina-public-")?"sina":provider;state["taxonomy"]=taxonomy;
        state["boardKey"]=sectorWatch::queryKey(query);state["boardFilter"]=code;state["filter"]="";
        target->restoreState(state);
      } catch(const std::exception& e) { page->setHostError(QString::fromUtf8(e.what())); }
    });
    auto* imports=page->findChild<QPlainTextEdit*>("discoveryImportText")->parentWidget();
    auto* choose=button("选择发现档案并预览","discoveryChooseFile",imports);imports->layout()->addWidget(choose);
    connect(choose,&QPushButton::clicked,page,[page]{
      const auto path=QFileDialog::getOpenFileName(page,"预览完整发现档案",{},"JSON (*.json)");if(path.isEmpty())return;
      try { QFile file(path);business::require(file.open(QIODevice::ReadOnly)&&file.size()<=8*1024*1024,"文件不可读或超过8MiB");page->previewImport(file.readAll()); }
      catch(const std::exception& e) {page->setHostError(QString::fromUtf8(e.what()));}
    });
    if(settings) {
      const auto state=QJsonDocument::fromJson(settings->value("industryDiscovery/state").toByteArray()).object();
      if(!state.isEmpty())page->restoreState(state);
    }
  }
  activatePage(page);
}
void Window::marketComparisonView() {
  try {
    auto* page=qobject_cast<MarketComparisonPage*>(pages.value("marketComparison"));
    const auto dataRoot=QFileInfo(businessStore->filePath()).absolutePath();
    if(!page){
      page=new MarketComparisonPage(dataRoot+"/market-comparison-v1",dataRoot+"/legacy-archive/files/market-board-catalog.json",!testing,workspaceTabs);
      page->setProperty("workspace","主页");page->setProperty("pageTitle","大盘对比 / 领先线 / 成交节奏");pages["marketComparison"]=page;
      connect(page,&MarketComparisonPage::directoryRequested,this,&Window::sectorWatchView);
      connect(page,&MarketComparisonPage::globalRequested,this,&Window::globalMarketView);
      connect(page,&MarketComparisonPage::klineRequested,this,[this,page,dataRoot](QJsonObject definition){
        try{
          business::require(page->isVisible(),"已离开对比页面");
          const auto kind=definition["kind"].toString();
          if(kind=="board"){
            auto* target=qobject_cast<BoardSeriesWidget*>(pages.value("comparisonBoardChart"));
            if(!target){target=new BoardSeriesWidget(dataRoot+"/board-series-v1",!testing,workspaceTabs);target->setProperty("workspace","主页");target->setProperty("pageTitle","板块K线");pages["comparisonBoardChart"]=target;connect(target,&BoardSeriesWidget::backRequested,this,[this]{returnToPreviousPage();});}
            definition["provider"]="eastmoney-public-board";target->setBoard(definition);activatePage(target);
          }else if(kind=="stock"||kind=="index"||kind=="sector-index"){
            const auto symbol=definition["symbol"].toString();business::require(QRegularExpression("^(sh|sz)[0-9]{6}$").match(symbol).hasMatch(),"证券身份不明确");
            const auto id=symbol.left(2).toUpper()+":"+(kind=="stock"?"stock":"index")+":"+symbol.mid(2);
            QJsonObject target{{"id",id},{"symbol",symbol},{"name",definition["name"]},{"transient",true}};
            if(feed)feed->observe(target);home();loadInstrument(id);setPeriod("day");recordViewedInstrument();
          }else statusBar()->showMessage("当前成分估算没有供应商自身K线；未冒用同名板块。");
        }catch(const std::exception& e){statusBar()->showMessage(QString::fromUtf8(e.what()));}
      });
    }
    activatePage(page);
    page->reloadBoardCatalog(dataRoot+"/sector-watch-v1.sqlite");
  }catch(const std::exception& e){statusBar()->showMessage("大盘对比未打开："+QString::fromUtf8(e.what()));}
}
void Window::globalMarketView() {
  try {
    auto* page=qobject_cast<GlobalMarketPage*>(pages.value("globalMarket"));
    if(!page){
      page=new GlobalMarketPage(QFileInfo(businessStore->filePath()).absolutePath(),!testing,workspaceTabs);
      page->setProperty("workspace","主页");page->setProperty("pageTitle","全球行情 / VIX");pages["globalMarket"]=page;
      connect(page,&GlobalMarketPage::backRequested,this,[this,page]{if(page->isVisible())returnToPreviousPage();});
      if(settings){
        auto state=QJsonDocument::fromJson(settings->value("globalMarket/state").toByteArray()).object();
        if(!state.isEmpty())try{page->restoreState(state);}catch(const std::exception& e){statusBar()->showMessage("全球行情选项未恢复："+QString::fromUtf8(e.what()));}
      }
    }
    activatePage(page);
  }catch(const std::exception& e){statusBar()->showMessage("全球行情未打开："+QString::fromUtf8(e.what()));}
}
void Window::marketOverviewView() {
  auto* page=qobject_cast<MarketOverviewPage*>(pages.value("marketOverview"));
  if(!page){
    page=new MarketOverviewPage(QFileInfo(businessStore->filePath()).absolutePath()+"/market-overview-v1.sqlite",!testing,workspaceTabs);
    page->setProperty("workspace","主页");page->setProperty("pageTitle","市场全景 / 热度");pages["marketOverview"]=page;
    connect(page,&MarketOverviewPage::openSecondHistory,this,&Window::legacyHighFrequencyView);
    connect(page,&MarketOverviewPage::openIndex,this,[this,page](const QString& symbol){
      if(workspaceTabs->currentWidget()!=page||!page->isVisible()||isMinimized())return;
      try{
        QJsonObject target;for(auto value:marketOverview::chartIndices())if(value.toObject()["symbol"]==symbol)target=value.toObject();
        business::require(!target.isEmpty(),"不支持的指数身份，未猜测证券");
        if(feed)feed->observe(target);
        else{bool found=false;for(auto value:instruments)found|=value.toObject()["id"]==target["id"];if(!found){target["transient"]=true;instruments.append(target);}}
        home();loadInstrument(target["id"].toString());setPeriod("day");setLayoutMode("focus");recordViewedInstrument();
        if(feed)feed->refreshQuotes();
      }catch(const std::exception& e){page->setHostError(QString::fromUtf8(e.what()));}
    });
    connect(page,&MarketOverviewPage::openBoard,this,[this,page](QString code,QString taxonomy){
      try{
        auto query=sectorWatch::query("eastmoney-public-board",taxonomy,code);
        sectorWatchView();auto* target=qobject_cast<SectorWatchPage*>(pages.value("sectorWatch"));
        business::require(target,"板块观察入口不可用");
        auto state=target->saveState();state["provider"]="eastmoney-public-board";state["taxonomy"]=taxonomy;state["boardKey"]=sectorWatch::queryKey(query);state["boardFilter"]=code;state["memberId"]="";
        target->restoreState(state);
      }catch(const std::exception& e){page->setHostError(QString::fromUtf8(e.what()));}
    });
    auto* imports=button("选择观测档案并预览","overviewChooseFile",page);page->layout()->addWidget(imports);
    connect(imports,&QPushButton::clicked,page,[page]{auto path=QFileDialog::getOpenFileName(page,"预览完整观测档案",{},"JSON (*.json)");if(path.isEmpty())return;try{QFile file(path);business::require(file.open(QIODevice::ReadOnly)&&file.size()<=8*1024*1024,"文件不可读或超过8MiB");page->previewImport(file.readAll());}catch(const std::exception& e){page->setHostError(QString::fromUtf8(e.what()));}});
  }
  activatePage(page);
}
void Window::dataSafetyView() {
  auto* page=pages.value("dataSafety");
  if(!page){
    page=dataSafetyPage(businessStore,workspaceTabs,[this]{return dataSafetyInventory();},[this](const QJsonObject& plan){
      business::require(pages.value("dataSafety") && pages.value("dataSafety")->isVisible(),"已离开数据安全页面，未自动切换或恢复；重新进入后可再次交接");
      auto guard=[this,plan]{
        business::require(plan.value("schema")=="data-safety-plan-v1" && plan.value("eligible").toBool() && !plan.value("automaticApply").toBool(),"恢复计划尚不可交接");
        business::require(plan.value("baselineHash")==dataSafety::baselineHash(businessStore->backup()),"业务数据已变化，请回数据安全重新核验；未合并");
        DataSafetyStore settings(businessStore->filePath()+".data-safety.sqlite");
        business::require(plan.value("policyHash")==dataSafety::fingerprint(settings.settings()),"安全设置已变化，请重新核验；未合并");
      };
      guard();auto incoming=plan.value("incoming").toObject();incoming["mergePolicy"]="keep-existing";
      settingsView();previewBusinessRestore(pages.value("settings"),incoming,guard);
    });
    page->setProperty("workspace","设置");page->setProperty("pageTitle","数据位置 / 安全核验");pages["dataSafety"]=page;
  }
  activatePage(page);
}
QJsonArray Window::auctionAnalysisSnapshots() const {
  if(auctionHistoryLoaded)return auctionHistorySnapshots;
  QJsonArray snapshots;QSet<QString> seen;
  for(auto value:instruments){auto item=value.toObject();
    for(QString period:{"auctionOpening","auctionClosing"}){
      auto meta=item[period+"Meta"].toObject();auto input=meta["rawInput"].toObject();
      if(input.isEmpty())continue;
      const QString id=item["id"].toString();
      if(input["meta"].toObject()["instrumentId"]!=id)continue;
      const QString digest=QString::fromLatin1(QCryptographicHash::hash(QJsonDocument(input).toJson(QJsonDocument::Compact),QCryptographicHash::Sha256).toHex());
      const QString snapshotId=id+":"+period+":"+digest;if(seen.contains(snapshotId))continue;seen.insert(snapshotId);
      snapshots.append(QJsonObject{{"id",snapshotId},{"instrumentId",id},{"name",item["name"]},{"input",input},{"coverage",meta["coverage"]}});
    }
  }
  return snapshots;
}
void Window::reloadAuctionHistory(){
  auto* page=pages.value("auctionAnalysis");if(!page||auctionHistoryBusy)return;
  auctionHistoryBusy=true;auctionAnalysisRefresh(page,"正在后台只读核对本机竞价归档；当前阅读内容保留。");
  QJsonArray captured;int excluded=0;for(auto v:instruments){auto s=v.toObject();auto type=s["id"].toString().section(':',1,1);if(type=="stock"||type=="etf")captured.append(s);else ++excluded;}
  auto result=std::make_shared<QJsonObject>();const QString file=QFileInfo(businessStore->filePath()).absolutePath()+"/live/market-v1.sqlite";
  auto* worker=QThread::create([file,captured,result]{try{*result=auctionHistorySource::collect(file,captured);}catch(const std::exception&e){*result={{"snapshots",QJsonArray{}},{"state","failed"},{"reason",QString::fromUtf8(e.what())}};}});
  connect(worker,&QThread::finished,this,[this,result,excluded]{
    auctionHistoryBusy=false;auctionHistorySnapshots=result->value("snapshots").toArray();auctionHistoryLoaded=true;
    QString note=QString("本机竞价归档：%1 · %2\n检查归档%3，当前缓存%4，去重%5；指数/其他身份不适用%6。未发起网络采集。").arg(result->value("state").toString(),result->value("reason").toString()).arg(result->value("archiveRowsVisited").toInt()).arg(result->value("cacheRowsVisited").toInt()).arg(result->value("duplicates").toInt()).arg(excluded);
    note+="\n排除项："+QString::number(result->value("diagnostics").toArray().size())+"；可打开来源读取完整说明。";
    if(auto* p=pages.value("auctionAnalysis")){p->setProperty("sourceEvidence",QString::fromUtf8(QJsonDocument(*result).toJson(QJsonDocument::Indented)));auctionAnalysisRefresh(p,note);}
  });connect(worker,&QThread::finished,worker,&QObject::deleteLater);worker->start();
}
void Window::auctionAnalysisView() {
  auto* page=pages.value("auctionAnalysis");
  if(!page){
    page=auctionAnalysisPage(workspaceTabs,[this]{return auctionAnalysisSnapshots();},[this]{reloadAuctionHistory();});
    page->setObjectName("auctionAnalysisPage");page->setProperty("workspace","资金");page->setProperty("pageTitle","竞价八形态 / 历史覆盖");pages["auctionAnalysis"]=page;
    if(!testing)QTimer::singleShot(0,this,&Window::reloadAuctionHistory);
  }
  activatePage(page);
}
void Window::auctionView() {
  auto key = "auction:" + activeId;
  if (auto* existing = pages.value(key)) {
    activatePage(existing);
    return;
  }
  auto* d =
      businessPage(key, instrument["name"].toString() + " · 竞价", "资金");
  d->setObjectName("auctionPage");
  QString id = activeId;
  auto* layout = new QVBoxLayout(d);
  auto* tools = new QHBoxLayout;
  auto* phase = new QComboBox(d);
  phase->setObjectName("auctionPhase");
  phase->addItem("开盘 09:15–09:25", "auctionOpening");
  phase->addItem("收盘 14:57–15:00", "auctionClosing");
  tools->addWidget(new QLabel(instrument["name"].toString() + " · " + id, d));
  tools->addWidget(phase);
  auto* mode = new QComboBox(d);
  mode->setObjectName("auctionMode");
  mode->addItems({"本机报价观察", "授权虚拟竞价过程"});
  tools->addWidget(mode);
  tools->addStretch();
  auto* imports = button("导入竞价过程JSON", "importAuction", d);
  auto* close = button("回到行情", "closeAuction", d);
  tools->addWidget(imports);
  auto* analysis=button("八形态 / 历史覆盖","auctionAnalysis",d);tools->addWidget(analysis);
  connect(analysis,&QPushButton::clicked,this,&Window::auctionAnalysisView);
  tools->addWidget(close);
  layout->addLayout(tools);
  auto* state = new QLabel(d);
  state->setObjectName("auctionState");
  state->setWordWrap(true);
  layout->addWidget(state);
  auto* table = new QTableWidget(0, 7, d);
  table->setObjectName("auctionTable");
  table->setHorizontalHeaderLabels({"源时间", "参考价", "相对基准%",
                                    "虚拟匹配金额/万元", "未匹配买/股",
                                    "未匹配卖/股", "供需偏向"});
  table->setEditTriggers(QAbstractItemView::NoEditTriggers);
  table->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
  table->verticalHeader()->hide();
  layout->addWidget(table, 1);
  auto* note = new QLabel(
      "竞价价/量与连续交易盘口不同。当前公开分钟/"
      "报价源不含完整竞价过程；未取得字段时不补造。导入要求来源声明、证券完整身"
      "份、源时间与实际可用时间、CNY/"
      "股单位。八形态分析需同证券/来源/阶段/时刻的20个有效历史日；不足时只读原点，不判形态。",
      d);
  note->setWordWrap(true);
  layout->addWidget(note);
  auto render = [this, id, phase, mode, state, table, d] {
    if(!d->isVisible()||d->window()->isMinimized())return;
    QJsonObject s;
    for (auto v : instruments)
      if (v.toObject()["id"] == id) s = v.toObject();
    QString p = phase->currentData().toString();
    if (mode->currentIndex() == 0) p.replace("auction", "auctionQuote");
    auto rows = s[p].toArray();
    auto meta = s[p + "Meta"].toObject();
    const QJsonObject input{{"id",id},{"kind",p},{"rows",rows},{"meta",meta}};
    if(d->property("auctionInput").toJsonObject()==input)return;
    d->setProperty("auctionInput",input);
    table->setRowCount(rows.size());
    for (int i = 0; i < rows.size(); i++) {
      auto row = rows[i].toObject();
      table->setItem(i, 0, new QTableWidgetItem(row["label"].toString()));
      const QStringList fields{"price",        "changePercent", "matchedAmount",
                               "unmatchedBuy", "unmatchedSell", "imbalance"};
      for (int k = 0; k < fields.size(); k++)
        table->setItem(
            i, k + 1,
            new QTableWidgetItem(shortValue(
                marketdata::value(row, fields[k]) / (k == 2 ? 10000 : 1),
                k == 5 ? 4 : 2)));
    }
    state->setText(
        rows.isEmpty()
            ? (mode->currentIndex() == 0
                   ? "本机5秒报价观察 · "
                     "仅在所选竞价时段、窗口前台采样。尚无有效观察；盘外不发请"
                     "求。虚拟匹配/未匹配量未取得，不按零显示。\n" +
                         meta["error"].toString()
                   : "未接入虚拟竞价过程数据 · "
                     "不是零成交，也不使用普通买卖五档替代")
            : meta["source"].toString() + " · " + meta["dataDate"].toString() +
                  (mode->currentIndex() == 0
                       ? " · 本机观察，非虚拟撮合\n"
                       : " · 文件契约格式验证通过，提供方真实性未独立验证\n") +
                  meta["reason"].toString() + " · " +
                  meta["persistenceState"].toString() + "\n" +
                  meta["error"].toString());
  };
  connect(phase, &QComboBox::currentIndexChanged, d,
          [render](int) { render(); });
  connect(mode, &QComboBox::currentIndexChanged, d,
          [render](int) { render(); });
  auto* sampler = new QTimer(d);
  sampler->setInterval(5000);
  connect(sampler, &QTimer::timeout, d, [this, id, d, phase, mode] {
    if (feed && d->isVisible() && isActiveWindow() && !isMinimized() &&
        mode->currentIndex() == 0)
      feed->sampleAuction(id,
                          phase->currentIndex() == 0 ? "opening" : "closing");
  });
  sampler->start();
  auto* repaint=new VisibleRefresh(d);repaint->refresh=render;
  if (feed)
    connect(feed, &MarketFeed::updated, d,
            [repaint,id](const QString& changed) { if(changed.isEmpty()||changed==id)repaint->request(); });
  connect(close, &QPushButton::clicked, this, &Window::home);
  connect(imports, &QPushButton::clicked, d, [this, d, id, mode, render] {
    if (!feed) {
      QMessageBox::information(
          d, "测试状态", "确定性测试不写正式数据。竞价契约在单元测试中验证。");
      return;
    }
    auto path = QFileDialog::getOpenFileName(d, "选择经授权的竞价过程文件", {},
                                             "JSON (*.json)");
    if (path.isEmpty()) return;
    try {
      QFile file(path);
      if (!file.open(QIODevice::ReadOnly) || file.size() > 2 * 1024 * 1024)
        throw std::runtime_error("文件不可读或过大");
      QJsonParseError error;
      auto doc = QJsonDocument::fromJson(file.readAll(), &error);
      if (error.error != QJsonParseError::NoError || !doc.isObject())
        throw std::runtime_error("JSON无效");
      feed->importAuction(id, doc.object());
      mode->setCurrentIndex(1);
      render();
    } catch (const std::exception& e) {
      QMessageBox::warning(d, "竞价导入未完成", QString::fromUtf8(e.what()));
    }
  });
  render();
  activatePage(d);
}
void Window::rotation() {
  if(auto* existing=pages.value("rotation")){activatePage(existing);return;}
  auto* page=businessPage("rotation","明暗盘 / 板块轮动","资金");
  auto* layout=new QVBoxLayout(page);
  layout->addWidget(new RotationPage(QFileInfo(businessStore->filePath()).absolutePath()+"/rotation-v1.sqlite",!testing,page,
      testing&&rotationTestHooks?*rotationTestHooks:RotationSamplingHooks{},
      QCoreApplication::applicationDirPath()+"/paper-session-2026-july-v1"));
  activatePage(page);
}
void Window::etfDailyView() {
  if(auto* existing=pages.value("etfDaily")){activatePage(existing);return;}
  auto* page=businessPage("etfDaily","ETF申赎日报","资金");auto* layout=new QVBoxLayout(page);
  auto* monitorButton=button("ETF盘中观察","openEtfMonitor",page);layout->addWidget(monitorButton);connect(monitorButton,&QPushButton::clicked,this,&Window::etfMonitorView);
  auto*futuresButton=button("股指期货价量仓","openFuturesMonitor",page);layout->addWidget(futuresButton);connect(futuresButton,&QPushButton::clicked,this,&Window::futuresMonitorView);
  auto*disclosure=button("股指期货指定日披露","openCffexDisclosure",page);layout->addWidget(disclosure);connect(disclosure,&QPushButton::clicked,this,&Window::cffexDisclosureView);
  auto* etf=etfUpdater;layout->addWidget(etf);etf->show();
  connect(etf,&EtfPage::quoteRequested,this,[this,etf](const QString& id){for(auto v:instruments)if(v.toObject()["id"]==id){home();loadInstrument(id);if(activeId==id)recordViewedInstrument();return;}etf->findChild<QLabel*>("etfState")->setText("该ETF尚不在本机自选，请先通过自选管理添加；未按代码猜测市场。");});activatePage(page);
}
void Window::darkStockView() {
  if(auto* existing=pages.value("darkStocks")){activatePage(existing);return;}
  auto* page=businessPage("darkStocks","个股明暗盘","资金");
  auto* layout=new QVBoxLayout(page);
  auto* view=new DarkStockPage(QFileInfo(businessStore->filePath()).absolutePath()+"/dark-stocks-v1",!testing,page);
  QStringList symbols;for(auto v:instruments)if(!v.toObject()["transient"].toBool())symbols << v.toObject()["symbol"].toString();
  view->setSymbols(symbols);layout->addWidget(view);
  connect(view,&DarkStockPage::stockRequested,this,[this,view](const QString& symbol){for(auto v:instruments)if(v.toObject()["symbol"]==symbol){const auto id=v.toObject()["id"].toString();home();loadInstrument(id);if(activeId==id)recordViewedInstrument();return;}view->findChild<QLabel*>("darkStockState")->setText("请先把该股票加入自选，再打开行情；没有自动改写自选。");});
  activatePage(page);
}
void Window::funds() {
  if (auto* existing = pages.value("funds")) {
    activatePage(existing);
    return;
  }
  auto* d = businessPage("funds", "资金看板", "资金");
  d->setObjectName("fundsPage");
  auto* layout = new QVBoxLayout(d);
  auto* tools = new QHBoxLayout;
  auto* symbols = new QComboBox(d);
  symbols->setObjectName("fundSymbols");
  for (auto v : instruments) {
    auto s = v.toObject();
    symbols->addItem(s["name"].toString() + "  " + s["symbol"].toString(),
                     s["id"].toString());
  }
  symbols->setCurrentIndex(std::max(0, symbols->findData(activeId)));
  auto* modes = new QComboBox(d);
  modes->setObjectName("fundMode");
  modes->addItem("历史资金 · 日线", "day");
  modes->addItem("盘中资金", "minute");
  modes->addItem("分类资金快照", "snapshot");
  modes->addItem("明暗盘 · 模型估算", "dark");
  auto *refresh = button("更新当前标的", "refreshFunds", d),
       *exports = button("导出来源数据", "exportFunds", d),
       *close = button("回到行情", "closeFunds", d);
  tools->addWidget(symbols, 1);
  tools->addWidget(modes);
  tools->addWidget(refresh);
  tools->addWidget(exports);
  tools->addWidget(close);
  auto* rotationButton=button("明暗盘 / 板块轮动","openRotation",d);
  tools->addWidget(rotationButton);
  connect(rotationButton,&QPushButton::clicked,this,[this,d]{
    if(workspaceTabs->currentWidget()!=d||!d->isVisible()||isMinimized()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return;
    rotation();
  });
  auto* monitorButton=button("ETF盘中观察","openEtfMonitor",d);tools->addWidget(monitorButton);connect(monitorButton,&QPushButton::clicked,this,&Window::etfMonitorView);
  auto* etfButton=button("ETF申赎日报","openEtfDaily",d);tools->addWidget(etfButton);connect(etfButton,&QPushButton::clicked,this,&Window::etfDailyView);
  auto*disclosure=button("期货指定日披露","openCffexDisclosure",d);tools->addWidget(disclosure);connect(disclosure,&QPushButton::clicked,this,&Window::cffexDisclosureView);
  auto* stockDark=button("个股明暗盘","openDarkStocks",d);tools->addWidget(stockDark);connect(stockDark,&QPushButton::clicked,this,[this,d]{
    if(workspaceTabs->currentWidget()!=d||!d->isVisible()||isMinimized()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return;
    darkStockView();
  });
  layout->addLayout(tools);
  // Keep legacy deep-link controls, but row selection is now the visible entry.
  symbols->hide();
  for(auto* lowFrequency:{exports,rotationButton,monitorButton,etfButton,disclosure,stockDark}){
    tools->removeWidget(lowFrequency);lowFrequency->hide();lowFrequency->setProperty("settingsControl",true);
  }
  auto* cancelFunds=button("取消当前资金请求","cancelFunds",d);tools->insertWidget(2,cancelFunds);
  connect(cancelFunds,&QPushButton::clicked,d,[this]{if(feed)feed->cancelCapitalDay();});
  auto* capitalPages=new QStackedWidget(d);capitalPages->setObjectName("capitalWorkbenchPages");
  auto* roster=new CapitalWorkbenchRoster(QFileInfo(businessStore->filePath()).absolutePath()+"/dark-stocks-v1",instruments,!testing,capitalPages);
  auto* lower=new QWidget(capitalPages);capitalPages->addWidget(roster);capitalPages->addWidget(lower);layout->addWidget(capitalPages,1);
  layout=new QVBoxLayout(lower);layout->setContentsMargins(0,0,0,0);
  auto* backList=button("返回资金列表（Backspace）","capitalBackToList",lower);layout->addWidget(backList,0,Qt::AlignLeft);
  connect(backList,&QPushButton::clicked,capitalPages,[capitalPages]{capitalPages->setCurrentIndex(0);});
  auto* selectedTitle=new QLabel(lower);selectedTitle->setObjectName("capitalSelectedTitle");selectedTitle->setTextFormat(Qt::PlainText);auto selectedFont=selectedTitle->font();selectedFont.setPointSize(13);selectedFont.setBold(true);selectedTitle->setFont(selectedFont);layout->addWidget(selectedTitle);
  auto* state = new QLabel(d);
  state->setObjectName("fundState");
  state->setWordWrap(true);
  layout->addWidget(state);
  auto* summary = new QLabel(d);
  summary->setObjectName("fundSummary");
  summary->setWordWrap(true);
  layout->addWidget(summary);
  auto* historyTools = new QHBoxLayout;
  auto* dates = new QComboBox(d);
  dates->setObjectName("fundDate");
  dates->setMinimumContentsLength(22);
  dates->setSizeAdjustPolicy(QComboBox::AdjustToContents);
  dates->addItem("当前来源", "");
  dates->hide(); // Keep archive identity internally; the user selects a calendar.
  auto* fundCalendar=new QDateEdit(QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date(),d);
  fundCalendar->setObjectName("fundHistoryDate");fundCalendar->setCalendarPopup(true);fundCalendar->setDisplayFormat("yyyy-MM-dd");
  auto* latestFunds=button("最新数据","fundLatestData",d);
  auto* imports = button("导入旧资金档案", "importFunds", d);
  imports->setProperty("settingsControl",true);
  auto* play = button("播放 / 暂停", "playFunds", d);
  auto* cursor = new QSlider(Qt::Horizontal, d);
  cursor->setObjectName("fundCursor");
  historyTools->addWidget(fundCalendar);historyTools->addWidget(latestFunds);
  historyTools->addWidget(imports);
  historyTools->addWidget(play);
  historyTools->addWidget(cursor, 1);
  layout->addLayout(historyTools);
  imports->hide();
  auto* timer = new QTimer(d);
  timer->setInterval(300);
  auto displayed = std::make_shared<QJsonObject>();
  auto selectedKey = std::make_shared<QString>();
  auto archive = std::make_shared<QJsonObject>();
  auto lastInput = std::make_shared<QJsonObject>();
  auto* timeline = new CapitalTimeline(d);
  auto* chartScroll = new QScrollArea(d);chartScroll->setObjectName("fundTimelineScroll");chartScroll->setWidget(timeline);chartScroll->setWidgetResizable(true);chartScroll->setMinimumHeight(260);layout->addWidget(chartScroll,2);
  auto* metric = new QComboBox(d);metric->setObjectName("fundMetric");for(auto pair:{qMakePair("主力 / 暗盘 / 明盘","all"),qMakePair("主力净额","mainNet"),qMakePair("超大单","superNet"),qMakePair("大单","largeNet"),qMakePair("中单","mediumNet"),qMakePair("小单","smallNet"),qMakePair("暗盘 · 模型估算","darkNet"),qMakePair("明盘 · 模型估算","visibleNet"),qMakePair("全部七类","seven")})metric->addItem(pair.first,pair.second);historyTools->insertWidget(0,metric);
  connect(metric,&QComboBox::currentIndexChanged,timeline,[metric,timeline]{timeline->setMetric(metric->currentData().toString(),metric->currentText());});
  auto* candleToggle=new QCheckBox("叠加日K",d);candleToggle->setObjectName("fundCandleToggle");candleToggle->setChecked(true);historyTools->insertWidget(1,candleToggle);
  connect(candleToggle,&QCheckBox::toggled,timeline,[timeline](bool show){timeline->setCandlesVisible(show);});
  auto* backfillRow=new QHBoxLayout;auto* from=new QDateEdit(QDate::currentDate().addDays(-90),lower);auto* through=new QDateEdit(QDate::currentDate().addDays(-1),lower);
  from->setObjectName("capitalHistoryFrom");through->setObjectName("capitalHistoryThrough");for(auto* field:{from,through}){field->setDisplayFormat("yyyy-MM-dd");field->setCalendarPopup(true);field->setMaximumDate(QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date());}
  auto* historyFetch=button("回补明暗日线","capitalHistoryBackfill",lower);auto* historyCancel=button("取消回补","capitalHistoryCancel",lower);historyCancel->setEnabled(false);
  auto* backfillState=new QLabel("历史按日取完整榜单；仅来源模型估算。原观察保留，不能还原过去逐笔轨迹。",lower);backfillState->setObjectName("capitalHistoryState");backfillState->setWordWrap(true);
  backfillState->setToolTip(backfillState->text());backfillState->clear();
  backfillRow->addWidget(new QLabel("明暗历史范围",lower));backfillRow->addWidget(from);backfillRow->addWidget(through);backfillRow->addWidget(historyFetch);backfillRow->addWidget(historyCancel);backfillRow->addStretch();layout->insertLayout(2,backfillRow);layout->insertWidget(3,backfillState);
  historyFetch->setEnabled(!testing);connect(historyFetch,&QPushButton::clicked,roster,[roster,from,through]{roster->backfill(from->date(),through->date());});connect(historyCancel,&QPushButton::clicked,roster,[roster]{roster->cancelBackfill();});
  roster->backfillChanged=[this,historyFetch,historyCancel,backfillState](QString text,bool busy){backfillState->setText(text);historyFetch->setEnabled(!busy&&!testing);historyCancel->setEnabled(busy);};
  auto* table = new QTableWidget(0, 9, d);
  table->setObjectName("fundTable");
  financialVisual::install(table,{1,2,3,4,5});
  financialVisual::install(table,{6,7},false);
  table->setHorizontalHeaderLabels({"来源时间", "主力净额", "超大单", "大单",
                                    "中单", "小单", "变化/分钟", "变化加速度",
                                    "状态"});
  table->setEditTriggers(QAbstractItemView::NoEditTriggers);
  table->setSelectionBehavior(QAbstractItemView::SelectRows);
  table->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
  table->verticalHeader()->hide();
  addDataDetails(layout,table,"fundRecordsDetails");
  auto* note = new QLabel(
      "单位：万元。正负值是来源分类净额，不是总买入/"
      "总卖出；不等于机构账户持仓。历史日期按源返回，不造缺失交易日。",
      d);
  note->setWordWrap(true);
  layout->addWidget(note);
  auto render = [this, d, symbols, modes, state, summary, table, dates, cursor,
                 displayed, selectedKey, refresh, archive, lastInput, timeline,roster,selectedTitle,metric,note,fundCalendar] {
    if (!d->isVisible() || workspaceTabs->currentWidget() != d) return;
    QJsonObject selected;
    auto id = symbols->currentData().toString();
    // The main quote table is coalesced; its copy can lag this notification.
    const auto& currentInstruments = feed ? feed->instruments : instruments;
    for (auto v : currentInstruments)
      if (v.toObject()["id"] == id) selected = v.toObject();
    selectedTitle->setText(selected["name"].toString()+"  "+selected["symbol"].toString().mid(2));
    const bool model=modes->currentData()=="dark";
    note->setText(model?"单位：万元。明暗盘为来源模型估算，非交易所逐笔资金；时间只取原记录，缺值不补零，单点不推断趋势。":"单位：万元。主力分类与明暗模型独立、不相加。明暗日线按来源交易日对齐，原抓取时间另存；镜像柱长为绝对值，颜色表示净额正负。历史缺口不补零。");
    metric->setVisible(!model);dates->setEnabled(!model);
    if(model){
      refresh->setText("更新明暗榜");
      cursor->setEnabled(false);auto rows=roster->modelRows();timeline->setMetric("darkPair","暗盘 / 明盘 · 模型估算");timeline->setRows(rows);
      table->setRowCount(0);*displayed={};*lastInput={};state->setText(roster->modelStatus());
      summary->setText(QString("原始观察 %1 点 · 明盘上栏、暗盘下栏；红正绿负。与主力分类净额独立，不相加。").arg(rows.size()));return;
    }
    timeline->setMetric(metric->currentData().toString(),metric->currentText());
    QString p = modes->currentData() == "snapshot" ? "capitalSnapshot" : modes->currentData() == "day" ? "capitalDay" : "capitalMinute";
    auto meta = selected[p + "Meta"].toObject();
    auto rows = selected[p].toArray();
    if(p=="capitalDay"&&fundCalendar->property("chosen").toBool()){
      QJsonArray bounded;const auto limit=tradingDaySelection::effective(fundCalendar->date()).toString(Qt::ISODate);
      for(auto value:rows)if(value.toObject()["label"].toString().left(10)<=limit)bounded.append(value);rows=bounded;
    }
    bool history = !dates->currentData().toString().isEmpty();
    if (history) {
      const bool matches = (*archive)["id"] == id && (*archive)["date"] == dates->currentData().toString();
      meta = matches ? (*archive)["record"].toObject() : QJsonObject();
      rows = meta["rows"].toArray();
      if (matches && !(*archive)["error"].toString().isEmpty()) meta["error"] = (*archive)["error"];
    }
    QJsonObject input{{"id",id},{"mode",p},{"date",dates->currentData().toString()},{"calendar",fundCalendar->property("chosen").toBool()?fundCalendar->date().toString(Qt::ISODate):QString()},
                      {"meta",meta},{"rows",rows},{"cursor",cursor->value()},{"modelHistory",roster->historicalModelRows()},{"candles",selected["day"]}};
    if (*lastInput == input) return;
    *lastInput = input;
    bool snapshot = !history && p == "capitalSnapshot";
    if(snapshot && meta["snapshot"].isObject()) {
      auto row=meta["snapshot"].toObject();row["label"]="源时刻未知";rows=QJsonArray{row};
    }
    modes->setVisible(!history);
    refresh->setText(history ? "重读历史" : "更新当前标的");
    if (p == "capitalMinute" || history)
      rows = marketdata::capitalKinematics(rows);
    if (testing) {
      rows = QJsonArray{QJsonObject{{"label", "2026-10-08"},
                                    {"mainNet", -1000000},
                                    {"superNet", -400000},
                                    {"largeNet", -600000},
                                    {"mediumNet", 700000},
                                    {"smallNet", 300000}},
                        QJsonObject{{"label", "2026-10-09"},
                                    {"mainNet", 2000000},
                                    {"superNet", 1200000},
                                    {"largeNet", 800000},
                                    {"mediumNet", -1500000},
                                    {"smallNet", -500000}}};
    }
    *displayed = meta;
    (*displayed)["rows"] = snapshot ? QJsonArray() : rows;
    (*displayed)["id"] = id;
    QString key = id + "/" + p + "/" + dates->currentData().toString();
    int count = rows.size();
    {
      QSignalBlocker block(cursor);
      cursor->setMaximum(std::max(0, count - 1));
      if (*selectedKey != key || cursor->property("count").toInt() != count)
        cursor->setValue(std::max(0, count - 1));
      cursor->setProperty("count", count);
      *selectedKey = key;
    }
    (*lastInput)["cursor"] = cursor->value();
    cursor->setEnabled(history && count > 1);
    if (history)
      while (rows.size() > cursor->value() + 1) rows.removeLast();
    auto modelHistory=roster->historicalModelRows();auto candles=selected["day"].toArray();
    if(fundCalendar->property("chosen").toBool()){
      const auto limit=tradingDaySelection::effective(fundCalendar->date()).toString(Qt::ISODate);
      auto bounded=[limit](QJsonArray values){QJsonArray out;for(auto v:values){auto row=v.toObject();const auto day=row["tradingDay"].toString(row["label"].toString().left(10));if(!day.isEmpty()&&day<=limit)out.append(v);}return out;};
      modelHistory=bounded(modelHistory);candles=bounded(candles);
    }
    const bool dailyChart=(!history&&p=="capitalDay")||rows.isEmpty();
    timeline->setRows(dailyChart?capitalWorkbench::dailySeries(rows,modelHistory,candles):rows);
    table->setRowCount(rows.size());
    const QStringList fields{
        "mainNet",  "superNet",     "largeNet",           "mediumNet",
        "smallNet", "netFlowSpeed", "netFlowAcceleration"};
    for (int i = 0; i < rows.size(); i++) {
      auto row = rows[rows.size() - 1 - i].toObject();
      table->setItem(i, 0, new QTableWidgetItem(row["label"].toString()));
      for (int k = 0; k < fields.size(); k++) {
        double v = marketdata::value(row, fields[k]);
        auto* item = new NumericItem(shortValue(v / 10000), v);
        table->setItem(i, k + 1, item);
      }
      table->setItem(i, 8,
                     new QTableWidgetItem(
                         row["flowState"].toObject()["label"].toString()));
    }
    QString saved = meta["persistenceState"] == "saved"     ? "已保存"
                    : meta["persistenceState"] == "pending" ? "保存中"
                    : meta["persistenceState"] == "failed"
                        ? "未保存 · 原记录保留"
                        : "";
    state->setText(testing ? "设计测试数据 · 非实时"
                   : rows.isEmpty() && meta["source"].toString().isEmpty()
                       ? "暂无资金数据，请更新当前标的。\n" +
                             meta["error"].toString()
                       : meta["source"].toString() + " · " +
                             meta["dataDate"].toString() + " · " + saved +
                             (meta["cached"].toBool() ? " · 旧缓存" : "") +
                             "\n" + meta["error"].toString());
    if (!testing && !meta["warning"].toString().isEmpty())
      state->setText(state->text() + "\n" + meta["warning"].toString() +
                     QString(" · 待核原行 %1").arg(meta["pendingRows"].toArray().size()));
    summary->setText(
        rows.isEmpty()
            ? "来源未返回：不能按零解释"
            : QString("已显示 %1 行 · 当前主力分类净额 %2 万元")
                  .arg(rows.size())
                  .arg(shortValue(
                      marketdata::value(rows.last().toObject(), "mainNet") /
                      10000)));
    if (history && !rows.isEmpty())
      summary->setText(summary->text() +
                       QString(" · 回放 %1/%2 · %3（非实时）")
                           .arg(rows.size())
                           .arg(count)
                           .arg(rows.last().toObject()["label"].toString()));
    if(snapshot && !testing) state->setText(state->text()+"\n资金源时刻未知；抓取时间 "+meta["checkedAt"].toString()+"（不是数据时刻）。不生成分时曲线。");
    if(!testing&&meta["requestProtocol"]=="first-party-mobile-public-json/v1")
      state->setText(state->text()+"\n东方财富官网移动历史通道 · 保留原交易日期与五类净额，非机构账户流水。");
    if(!testing&&!meta["checkedAt"].toString().isEmpty())state->setText(state->text()+" · 记录获取时刻 "+QDateTime::fromString(meta["checkedAt"].toString(),Qt::ISODate).toOffsetFromUtc(28800).toString("MM-dd HH:mm:ss")+"（非数据日期）");
    if(id.contains(":index:"))state->setText(state->text()+"\n指数来源分类资金，非指数成交额，也非本软件成分股估算。");
    if(dailyChart&&!modelHistory.isEmpty())summary->setText(summary->text()+" · 明暗历史独立可用（最后留存观察，非本次更新）。");
    state->setToolTip(state->text());state->setText(state->text().section('\n',0,0));
    note->setToolTip(note->text());note->setText("万元 · 主力分类与明暗模型独立，不相加；缺值不补零");
  };
  auto* reader = new CapitalArchiveReader(d, feed ? feed->capitalArchivePath() : QString(),
      [symbols, dates, archive, render, state, lastInput](QString id, QString date, QJsonObject result, QString error) {
        if (symbols->currentData() != id || dates->currentData().toString() != date) return;
        if (!error.isEmpty()) {
          if ((*archive)["id"] != id || (*archive)["date"] != date) *archive = {{"id",id},{"date",date}};
          (*archive)["error"] = error;
          render(); state->setText("历史读取暂未完成，请重试；原记录保留。\n" + error); return;
        }
        *archive = result; (*archive)["id"] = id; (*archive)["date"] = date;
        *lastInput = {}; // Also clear a prior read-error presentation after a successful retry.
        { QSignalBlocker block(symbols);
          for (auto value : result["ids"].toArray()) {
            const auto key = value.toString();
            if (symbols->findData(key) < 0) symbols->addItem(key + " · 历史档案", key);
          }
        }
        QStringList wanted; for (auto value : result["dates"].toArray()) wanted << value.toString();
        if (!date.isEmpty() && !wanted.contains(date)) wanted.prepend(date);
        QStringList current; for (int i=1;i<dates->count();++i) current << dates->itemData(i).toString();
        if (current != wanted) {
          QSignalBlocker block(dates); dates->clear(); dates->addItem("当前来源", "");
          for (const auto& day : wanted) dates->addItem(day, day);
          dates->setCurrentIndex(std::max(0, dates->findData(date)));
        }
        render();
      });
  auto readArchive = [this, reader, symbols, dates] {
    if (feed) reader->request(symbols->currentData().toString(), dates->currentData().toString());
  };
  reader->shown = [render, readArchive] { render(); readArchive(); };
  auto request = [this, d, symbols, modes, dates, render, readArchive,roster](bool force) {
    render();
    if(modes->currentData()=="dark"){if(force&&!testing)roster->load(true);return;}
    readArchive();
    if(workspaceTabs->currentWidget()!=d||!d->isVisible()||isMinimized()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return;
    if (feed && dates->currentData().toString().isEmpty())
      feed->capitalFlow(symbols->currentData().toString(),
                        modes->currentData().toString(), force);
  };
  connect(symbols, &QComboBox::currentIndexChanged, d,
          [dates, archive, request](int) { QSignalBlocker block(dates); dates->clear(); dates->addItem("当前来源", ""); *archive = {}; request(false); });
  roster->selected=[this,symbols,modes,render,capitalPages](QJsonObject s){
    if(feed)try{feed->observe(s);}catch(const std::exception& e){statusBar()->showMessage(QString::fromUtf8(e.what()));return;}
    auto id=s["id"].toString();if(symbols->findData(id)<0)symbols->addItem(s["name"].toString()+" "+s["symbol"].toString().mid(2),id);
    if(feed)feed->chart(id,"day");
    if(id.contains(":index:")&&modes->currentData()!=QString("day")){QSignalBlocker block(modes);modes->setCurrentIndex(modes->findData("day"));}
    capitalPages->setCurrentIndex(1);symbols->setCurrentIndex(symbols->findData(id));render();
  };
  roster->modelChanged=[render](QJsonArray,QString){render();};
  roster->setCurrent(symbols->currentData().toString());roster->updateSources(publicMarketRuntime?publicMarketRuntime->stockView(feed?feed->instruments:instruments):(feed?feed->instruments:instruments));
  connect(modes, &QComboBox::currentIndexChanged, d,
          [request](int) { request(false); });
  connect(refresh, &QPushButton::clicked, d, [request] { request(true); });
  connect(dates, &QComboBox::currentIndexChanged, d,
          [this, render, readArchive](int) { if(feed)feed->cancelCapitalDay(); render(); readArchive(); });
  connect(fundCalendar,&QDateEdit::dateChanged,d,[fundCalendar,dates,modes,render,roster](QDate chosen){
    fundCalendar->setProperty("chosen",true);fundCalendar->setToolTip(tradingDaySelection::caption(chosen));
    roster->findChild<QDateEdit*>("capitalModelDate")->setDate(chosen);
    if(modes->currentData()=="day"||modes->currentData()=="dark"){dates->setCurrentIndex(0);render();return;}
    const auto day=tradingDaySelection::effective(chosen).toString(Qt::ISODate);int pos=dates->findData(day);
    if(pos<0){dates->addItem(day,day);pos=dates->count()-1;}dates->setCurrentIndex(pos);
  });
  connect(latestFunds,&QPushButton::clicked,d,[fundCalendar,dates,render]{fundCalendar->setProperty("chosen",false);dates->setCurrentIndex(0);render();});
  connect(cursor, &QSlider::valueChanged, d, [render](int) { render(); });
  connect(play, &QPushButton::clicked, d, [timer, cursor] {
    if (timer->isActive())
      timer->stop();
    else if (cursor->isEnabled()) {
      if (cursor->value() == cursor->maximum()) cursor->setValue(0);
      timer->start();
    }
  });
  connect(timer, &QTimer::timeout, d, [timer, cursor, d] {
    if (!d->isVisible() || cursor->value() >= cursor->maximum()) {
      timer->stop();
      return;
    }
    cursor->setValue(cursor->value() + 1);
  });
  connect(imports, &QPushButton::clicked, d,
          [this, d, symbols, dates, render, readArchive, state] {
            if (!feed) return;
            auto path = QFileDialog::getOpenFileName(d, "导入旧程序资金历史",
                                                     {}, "JSON (*.json)");
            if (path.isEmpty()) return;
            try {
              QFile f(path);
              if (!f.open(QIODevice::ReadOnly) || f.size() > 8 * 1024 * 1024)
                throw std::runtime_error("文件不可读或超过8MB");
              auto input = QJsonDocument::fromJson(f.readAll()).object();
              feed->importCapital(symbols->currentData().toString(), input);
              render();
              auto day =
                  QDateTime::fromString(
                      input["observation"].toObject()["observedAt"].toString(),
                      Qt::ISODate)
                      .toOffsetFromUtc(28800)
                      .date()
                      .toString(Qt::ISODate);
              if (dates->findData(day) < 0) dates->addItem(day,day);
              dates->setCurrentIndex(dates->findData(day));
              render();
              readArchive();
            } catch (const std::exception& e) {
              state->setText("导入未完成：" + QString::fromUtf8(e.what()));
            }
          });
  connect(close, &QPushButton::clicked, this, &Window::home);
  if (feed)
    connect(feed, &MarketFeed::updated, d,
            [this,roster,symbols, render](const QString& id) { roster->updateSources(publicMarketRuntime?publicMarketRuntime->stockView(feed->instruments):feed->instruments);if (id == symbols->currentData()) render(); });
  if (feed)
    connect(feed, &MarketFeed::capitalArchiveChanged, d,
            [symbols, readArchive](const QString& id) { if (id == symbols->currentData()) readArchive(); });
  connect(exports, &QPushButton::clicked, d, [d, displayed] {
    auto data = *displayed;
    if (data["rawLegacy"].isObject()) data = data["rawLegacy"].toObject();
    if (data["rows"].toArray().isEmpty() &&
        data["points"].toArray().isEmpty() && !data["snapshot"].isObject()) {
      QMessageBox::information(d, "无可导出数据", "当前没有有效来源数据。");
      return;
    }
    auto file = QFileDialog::getSaveFileName(d, "导出资金来源记录",
                                             "资金历史.json", "JSON (*.json)");
    if (file.isEmpty()) return;
    QSaveFile out(file);
    if (!out.open(QIODevice::WriteOnly) ||
        out.write(QJsonDocument(data).toJson()) < 0 || !out.commit())
      QMessageBox::warning(d, "导出失败", "原文件保留。");
  });
  activatePage(d);
  request(false);
}
void Window::selectIndicator(const QString& name) {
  if (indicatorSelector->findText(name) < 0) return;
  indicatorSelector->setCurrentText(name);
  findChild<QPushButton*>("indicator" + name)->setChecked(true);
  for (auto* target : {chart, referenceChart}) {
    target->indicator = name;
    target->recalculate();
  }
  auto* source = inspectedChart ? inspectedChart : chart;
  explainChart(source, source->selected);
  if (settings) {
    settings->setValue("indicator", name);
    settings->sync();
  }
}
void Window::parameters() {
  QDialog d(this);
  d.setObjectName("parameterDialog");
  d.setWindowTitle("指标参数 · 两端相同口径");
  auto* l = new QFormLayout(&d);
  QSpinBox e, a, v, fast, slow, sig, kdj, rsi, cci;
  for (auto* s : {&e, &a, &v}) s->setRange(2, 120);
  for (auto* s : {&fast, &slow, &sig}) s->setRange(1, 500);
  fast.setValue(chart->macdFast);
  slow.setValue(chart->macdSlow);
  sig.setValue(chart->macdSignal);
  e.setValue(chart->emaPeriod);
  a.setValue(chart->atrPeriod);
  v.setValue(chart->volumePeriod);
  l->addRow("EMA 周期", &e);
  l->addRow("ATR 周期", &a);
  l->addRow("相对量能参考周期", &v);
  QComboBox type;
  type.addItems({"MA", "EMA"});
  type.setCurrentText(chart->maType);
  QStringList initial;
  for (auto n : chart->maPeriods) initial << QString::number(n);
  QLineEdit periods(initial.join(","));
  periods.setObjectName("maPeriods");
  l->addRow("主图均线算法", &type);
  l->addRow("均线周期/根（手动添加，逗号分隔）", &periods);
  QCheckBox annotationsOn("显示关键位 / 历史事件（所选闭合周期）");annotationsOn.setObjectName("chartAnnotationsEnabled");annotationsOn.setChecked(chart->annotationsEnabled);l->addRow(&annotationsOn);
  QCheckBox vwapOn("显示 VWAP 主图线");vwapOn.setObjectName("vwapEnabled");vwapOn.setChecked(chart->vwapEnabled);l->addRow(&vwapOn);
  QComboBox vwapMode,vwapAnchor;vwapMode.setObjectName("vwapMode");vwapAnchor.setObjectName("vwapAnchor");
  vwapMode.addItem("收盘价×量近似（旧口径）","legacy-close-approx");vwapMode.addItem("HLC3×量近似","hlc3-approx");vwapMode.addItem("真实成交金额/量（缺数不回退）","actual-amount");
  vwapAnchor.addItem("自动：分时按交易日，K线按载入起点","auto");vwapAnchor.addItem("按交易日（周/月/年不适用）","session");vwapAnchor.addItem("当前载入起点（非全日均价）","loaded-window");
  vwapMode.setCurrentIndex(std::max(0,vwapMode.findData(chart->vwapMode)));vwapAnchor.setCurrentIndex(std::max(0,vwapAnchor.findData(chart->vwapAnchor)));
  l->addRow("VWAP计算口径",&vwapMode);l->addRow("VWAP累计范围",&vwapAnchor);
  l->addRow("MACD 快线", &fast);
  l->addRow("MACD 慢线", &slow);
  l->addRow("MACD 信号", &sig);
  kdj.setObjectName("kdjPeriod");
  rsi.setObjectName("rsiPeriod");
  cci.setObjectName("cciPeriod");
  for (auto* box : {&kdj, &rsi, &cci}) box->setRange(1, 500);
  kdj.setValue(chart->kdjPeriod);
  rsi.setValue(chart->rsiPeriod);
  cci.setValue(chart->cciPeriod);
  l->addRow("KDJ N（平滑固定3,3）", &kdj);
  l->addRow("RSI N（简单滚动）", &rsi);
  l->addRow("CCI N", &cci);
  l->addRow(new QLabel(
      "周期1–500，最多12条均线；MACD快线必须小于慢线。\n"
      "OBV无周期，按全载入历史累计；缺数与预热不填零。"));
  QList<int> configured;
  QDialogButtonBox box(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
  box.button(QDialogButtonBox::Ok)->setText("应用");
  box.button(QDialogButtonBox::Cancel)->setText("取消");
  l->addRow(&box);
  connect(&box, &QDialogButtonBox::accepted, &d, [&] {
    configured.clear();
    for (auto word : periods.text().split(QRegularExpression("[,;，\\s]+"),
                                          Qt::SkipEmptyParts)) {
      bool ok = false;
      int n = word.toInt(&ok);
      if (!ok || n < 1 || n > 500) {
        QMessageBox::warning(&d, "周期无效", "均线周期需为1–500整数。");
        return;
      }
      if (!configured.contains(n)) configured << n;
    }
    if (configured.isEmpty() || configured.size() > 12 ||
        fast.value() >= slow.value()) {
      QMessageBox::warning(&d, "参数无效",
                           "均线需1–12条，MACD快线必须小于慢线。");
      return;
    }
    d.accept();
  });
  connect(&box, &QDialogButtonBox::rejected, &d, &QDialog::reject);
  if (d.exec() == QDialog::Accepted) {
    for (auto* target : {chart, referenceChart}) {
      target->annotationsEnabled=annotationsOn.isChecked();
      target->vwapEnabled=vwapOn.isChecked();target->vwapMode=vwapMode.currentData().toString();target->vwapAnchor=vwapAnchor.currentData().toString();
      target->emaPeriod = e.value();
      target->atrPeriod = a.value();
      target->volumePeriod = v.value();
      target->maType = type.currentText();
      target->maPeriods = configured;
      target->macdFast = fast.value();
      target->macdSlow = slow.value();
      target->macdSignal = sig.value();
      target->kdjPeriod = kdj.value();
      target->rsiPeriod = rsi.value();
      target->cciPeriod = cci.value();
      target->recalculate();
    }
    auto* source = inspectedChart ? inspectedChart : chart;
    explainChart(source, source->selected);
    if (settings) {
      settings->setValue("chartAnnotations",annotationsOn.isChecked());
      settings->setValue("vwapEnabled",vwapOn.isChecked());settings->setValue("vwapMode",vwapMode.currentData());settings->setValue("vwapAnchor",vwapAnchor.currentData());
      settings->setValue("ema", e.value());
      settings->setValue("atr", a.value());
      settings->setValue("rvol", v.value());
      settings->setValue("maType", type.currentText());
      settings->setValue("maPeriods", periods.text());
      settings->setValue("macdFast", fast.value());
      settings->setValue("macdSlow", slow.value());
      settings->setValue("macdSignal", sig.value());
      settings->setValue("kdjPeriod", kdj.value());
      settings->setValue("rsiPeriod", rsi.value());
      settings->setValue("cciPeriod", cci.value());
      settings->sync();
    }
  }
}
void Window::editWatchVisibility() {
  QDialog d(this);
  d.setWindowTitle("管理自选 · 本机独立保存");
  d.resize(480, 640);
  auto* l = new QVBoxLayout(&d);
  l->addWidget(new QLabel("勾选显示的标的；不改写原程序数据库。"));
  if (feed) {
    auto* addStock = button("添加股票 / 指数 / ETF", "addInstrument");
    l->addWidget(addStock);
    connect(addStock, &QPushButton::clicked, &d, [this, &d] {
      QDialog addDialog(&d);
      addDialog.setWindowTitle("添加本机自选");
      auto* form = new QFormLayout(&addDialog);
      QComboBox exchange, type;
      exchange.addItems({"深圳 SZ", "上海 SH", "北京 BJ"});
      type.addItems({"股票", "指数", "ETF"});
      QLineEdit code, name, group;
      code.setPlaceholderText("六位代码");
      group.setText("默认分组");
      form->addRow("市场", &exchange);
      form->addRow("类型", &type);
      form->addRow("代码", &code);
      form->addRow("名称", &name);
      form->addRow("分组", &group);
      QDialogButtonBox box(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
      box.button(QDialogButtonBox::Ok)->setText("添加");
      box.button(QDialogButtonBox::Cancel)->setText("取消");
      form->addRow(&box);
      connect(&box, &QDialogButtonBox::rejected, &addDialog, &QDialog::reject);
      connect(&box, &QDialogButtonBox::accepted, &addDialog, [&] {
        QString ex = QStringList{"SZ", "SH", "BJ"}[exchange.currentIndex()],
                t = QStringList{"stock", "index", "etf"}[type.currentIndex()],
                c = code.text().trimmed();
        QString id = ex + ":" + t + ":" + c;
        try {
          feed->add({{"id", id},
                     {"symbol", ex.toLower() + c},
                     {"name", name.text().trimmed()},
                     {"group", group.text().trimmed()},
                     {"order", instruments.size()}});
          if (settings) settings->setValue("watch/" + id, true);
          refreshLive();
          addDialog.accept();
          d.reject();
        } catch (const std::exception& e) {
          QMessageBox::warning(&addDialog, "未添加",
                               QString::fromUtf8(e.what()));
        }
      });
      addDialog.exec();
    });
  }
  auto* scroll = new QScrollArea;
  auto* content = new QWidget;
  auto* items = new QVBoxLayout(content);
  scroll->setWidget(content);
  scroll->setWidgetResizable(true);
  l->addWidget(scroll, 1);
  QList<QCheckBox*> checks;
  QStringList checkedIds;
  for (auto v : instruments) {
    auto s = v.toObject();
    if (s["transient"].toBool()) continue;
    auto* c = new QCheckBox(s["name"].toString() + "  " + s["id"].toString().section(':', 2, 2));
    c->setToolTip(s["market"].toString());
    c->setChecked(
        !settings ||
        settings->value("watch/" + s["id"].toString(), true).toBool());
    checks << c;
    checkedIds << s["id"].toString();
    items->addWidget(c);
  }
  auto* color = button("设置当前分组识别色", "groupColor");
  l->addWidget(color);
  connect(color,&QPushButton::clicked,&d,[this,&d]{d.reject();editGroups();});
  auto* box =
      new QDialogButtonBox(QDialogButtonBox::Save | QDialogButtonBox::Cancel);
  box->button(QDialogButtonBox::Save)->setText("保存");
  box->button(QDialogButtonBox::Cancel)->setText("取消");
  l->addWidget(box);
  connect(box, &QDialogButtonBox::accepted, &d, &QDialog::accept);
  connect(box, &QDialogButtonBox::rejected, &d, &QDialog::reject);
  if (d.exec() == QDialog::Accepted) {
    if (settings)
      for (int i = 0; i < checks.size(); i++)
        settings->setValue(
            "watch/" + checkedIds[i],
            checks[i]->isChecked());
    fillStocks();
  }
}
void Window::selectTheme(const QString& id){
  themeId=appearance::theme(id).id;dark=appearance::theme(themeId).dark;
  if(settings){settings->setValue("appearance/theme",themeId);settings->setValue("dark",dark);settings->sync();}
  if(auto* choice=findChild<QComboBox*>("appearanceTheme")){QSignalBlocker blocker(choice);choice->setCurrentIndex(choice->findData(themeId));}
  applyTheme();
}
void Window::applyTheme() {
  const auto colors=appearance::theme(themeId);
  setProperty("stockTheme",themeId);
  const auto desiredPalette=appearance::palette(colors);
  if(palette()!=desiredPalette)setPalette(desiredPalette);
  // Full theme identity, not just light/dark: newly created pages still get styled.
  const auto stylePage = [this, &colors](auto* p) {
    if (p && p->property("appliedStockTheme").toString() != colors.id) {
      p->setDarkTheme(dark); p->setProperty("appliedStockTheme", colors.id);
    }
  };
  stylePage(dynamic_cast<WatchlistWorkspacePage*>(pages.value("watchlistWorkspace")));
  stylePage(dynamic_cast<WatchlistReconciliationPage*>(pages.value("watchlistReconciliation")));
  stylePage(dynamic_cast<paperHost::Page*>(pages.value("paperMonitor")));
  stylePage(dynamic_cast<PortfolioMirrorPage*>(pages.value("portfolioMirror")));
  stylePage(dynamic_cast<PersonMethodPage*>(pages.value("personMethod")));
  stylePage(dynamic_cast<QuantResearchPage*>(pages.value("quantResearch")));
  stylePage(dynamic_cast<RiskSettingsPage*>(pages.value("riskSettings")));
  chart->dark = referenceChart->dark = dark;
  QString bg=colors.bg.name(),fg=colors.text.name(),line=colors.border.name(),panel=colors.panel.name(),select=colors.selection.name();
  const auto desiredStyle=QString("QMainWindow,QWidget{background:%1;color:%2;font-family:'"
              "Microsoft YaHei UI';font-size:13px;}"
              "#header{background:%4;border-bottom:1px solid "
              "%3;}#toolbar{background:%4;}"
              "#moduleNavigation{background:%4;border-bottom:1px solid %3;}"
              "QToolBar#navigationToolbar{background:%4;border:0;spacing:3px;}"
              "QToolBar#navigationToolbar QToolButton{padding:4px 9px;border:1px solid transparent;border-radius:3px;}"
              "QToolBar#navigationToolbar QToolButton:checked{background:%5;color:#63a7ff;border-color:#467daf;}"
              "QToolBar#navigationToolbar QToolButton:hover{background:%5;}"
              "QToolBar#navigationToolbar QToolButton#qt_toolbar_ext_button{padding:0;border:1px solid %3;background:%5;}"
              "#brand{font-size:18px;font-weight:600;color:%2;}"
              "QPushButton{border:1px solid %3;border-radius:4px;padding:2px "
              "11px;background:%1;}"
              "QPushButton[indicatorControl=true]{padding:2px 5px;}"
              "QPushButton:hover{background:%5;border-color:#4d80b7;}"
              "QPushButton:checked{background:%5;color:#6baeff;border-color:#"
              "467daf;font-weight:600;}"
              "QPushButton[navigation=true]{border:0;background:transparent;"
              "font-size:14px;padding:2px 14px;}"
              "QPushButton[navigation=true]:checked{border-bottom:2px solid "
              "#63a7ff;color:#63a7ff;}"
              "QLineEdit{border:1px solid %3;border-radius:4px;padding:2px "
              "8px;selection-background-color:#316398;}"
              "QListWidget,QTableWidget,QTextBrowser{border:0;background:%1;"
              "alternate-background-color:%4;}"
              "QListWidget::item{padding:5px 8px;border-left:3px solid "
              "transparent;}"
              "QListWidget::item:selected{background:%5;color:%2;border-left:"
              "3px solid #63a7ff;}"
              "QTableWidget::item{padding:0 6px;border-bottom:1px solid %3;}"
              "QTableWidget::item:selected{background:%5;color:%2;}"
              "QHeaderView::section{background:%4;color:#8999ae;border:0;"
              "padding:5px 4px;font-size:12px;}"
              "QSplitter::handle{background:%3;}"
              "#marketStrip{padding:4px 12px;background:%1;border-bottom:1px "
              "solid %3;}"
              "#sectionTitle{font-size:13px;font-weight:600;padding:5px "
              "0;border-bottom:1px solid %3;}"
              "#chartReadout{font-family:Consolas;font-size:12px;color:#92a1b6;"
              "background:%4;padding:3px 6px;}"
              "#snapshot,#signalSummary{line-height:1.8;}#muted{color:#8899b0;"
              "font-size:12px;padding:4px 0;}"
              "#statusLabel{padding:4px "
              "12px;background:%4;font-size:11px;color:#8294aa;}"
              "QScrollBar:vertical{background:%1;width:7px;}QScrollBar::handle:"
              "vertical{background:%3;min-height:24px;}"
              "QScrollBar::add-line:vertical,QScrollBar::sub-line:vertical{"
              "height:0;}")
          .arg(bg, fg, line, panel, select)
          .replace("#8999ae",colors.muted.name()).replace("#92a1b6",colors.muted.name())
          .replace("#8899b0",colors.muted.name()).replace("#8294aa",colors.muted.name())
          .replace("#63a7ff",colors.accent.name()).replace("#6baeff",colors.accent.name())
          + QString("QPushButton,QToolButton,QComboBox{background:%1;color:%2;min-height:22px;}"
                    "QComboBox{border:1px solid %3;border-radius:4px;padding:2px 7px;}"
                    "QComboBox QAbstractItemView,QMenu{background:%4;color:%2;selection-background-color:%5;selection-color:%2;border:1px solid %3;}"
                    "QToolTip{background:%4;color:%2;border:1px solid %3;padding:5px;}"
                    "QPushButton:disabled,QToolButton:disabled,QComboBox:disabled{color:%6;background:%4;}"
                    "QCheckBox::indicator,QListView::indicator{width:14px;height:14px;border:1px solid %3;border-radius:3px;background:%1;}"
                    "QCheckBox::indicator:checked,QListView::indicator:checked{background:%7;border:3px solid %3;}"
                    "QTabBar::tab{background:%4;color:%2;padding:5px 9px;}QTabBar::tab:selected{background:%5;border-bottom:2px solid %7;}")
            .arg(colors.button.name(),fg,line,panel,select,colors.muted.name(),colors.accent.name());
  if(styleSheet()!=desiredStyle)setStyleSheet(desiredStyle);
  if(quote&&!activeId.isEmpty()&&instrument.value("id").toString()==activeId&&legacyHighFrequencyFrame.isEmpty()){
    const auto* source=inspectedChart?inspectedChart:chart;
    const auto html=selectedQuoteHtml(instrument,source,source?source->selected:-1,testing,colors);
    if(quote->text()!=html)quote->setText(html);
  }
  if(stocks){
    QSignalBlocker block(stocks);
    for(int r=0;r<stocks->rowCount();++r){
      const auto* change=stocks->item(r,2);
      const auto color=quoteForeground(colors,change?change->data(Qt::UserRole+1).toDouble():0.);
      for(int c=1;c<qMin(5,stocks->columnCount());++c)
        if(auto* item=stocks->item(r,c);item&&item->foreground().color()!=color)item->setForeground(color);
    }
    stocks->viewport()->update();
  }
  if(auto* p=qobject_cast<EtfMonitorPage*>(pages.value("etfMonitor")))
    if(p->property("appliedStockTheme").toString()!=colors.id){p->refreshAppearance();p->setProperty("appliedStockTheme",colors.id);}
  for(auto* c:findChildren<Chart*>()) {
    if(c->property("appliedStockTheme").toString()==colors.id)continue;
    c->dark=dark;c->setProperty("appliedStockTheme",colors.id);c->update();
  }
}

// Root-only insertion into Window.cpp. v42 replacement; no shared native source is edited.
void Window::unifiedBackupView() {
  using namespace unifiedBackup;
  if(auto* setup=pages.value("unifiedBackupSetup")){
    setup->setProperty("returnToRecent",false);setup->setProperty("returnToLeader",false);activatePage(setup);
    setup->findChild<QPushButton*>("backupScopeReload")->click();return;
  }
  auto* setup=new QWidget(workspaceTabs);auto* layout=new QVBoxLayout(setup);
  auto* note=new QLabel("统一非敏感备份\n勾选命名候选或完整背景方案，保留原编号和历史内容。每类最多100份，未勾选不导出。恢复范围以备份内记录为准；可不选候选，继续其它域。",setup);note->setWordWrap(true);layout->addWidget(note);
  auto* scroll=new QScrollArea(setup);scroll->setWidgetResizable(true);auto* body=new QWidget(scroll);auto* options=new QVBoxLayout(body);scroll->setWidget(body);layout->addWidget(scroll,1);
  QString directory=QFileInfo(businessStore->filePath()).absolutePath();
  auto* loading=new QLabel("正在准备备份范围，可继续切换页面。",setup);loading->setObjectName("backupScopeStatus");layout->addWidget(loading);
  auto* reloadScope=new QPushButton("刷新备份范围",setup);reloadScope->setObjectName("backupScopeReload");layout->addWidget(reloadScope);
  auto* extra=new QPlainTextEdit(setup);extra->setObjectName("candidateExtraIds");extra->setPlaceholderText("其它明确候选ID，每行一个；可留空");extra->setMaximumHeight(70);layout->addWidget(extra);
  auto* extraBackground=new QPlainTextEdit(setup);extraBackground->setObjectName("backgroundExtraIds");extraBackground->setPlaceholderText("其它明确背景方案ID，每行一个；可留空");extraBackground->setMaximumHeight(70);layout->addWidget(extraBackground);
  auto* begin=new QPushButton("以所选范围创建新操作（既有回执保留）",setup);layout->addWidget(begin);
  begin->setEnabled(false);setup->setProperty("scopeLoading",true);
  auto* scopeReader=new PageSnapshotReader(setup,{},[setup,body,options,loading,begin](QJsonObject result,QString error){
    setup->setProperty("scopeLoading",false);begin->setEnabled(true);
    if(!error.isEmpty()){loading->setText("范围读取失败，保留已有选择："+error);return;}
    QSet<QString> selected;for(auto* box:body->findChildren<QCheckBox*>())if(box->isChecked())selected.insert(box->property("scopeKind").toString()+QChar(0)+box->property("candidateId").toString());
    auto rows=result["rows"].toArray();QSet<QString> present;for(auto value:rows){auto row=value.toObject();present.insert(row["scopeKind"].toString()+QChar(0)+row["id"].toString());}for(auto* box:body->findChildren<QCheckBox*>()){auto kind=box->property("scopeKind").toString(),key=kind+QChar(0)+box->property("candidateId").toString();bool failed=result["failedKinds"].toArray().contains(kind),missing=box->isChecked()&&!present.contains(key);if((failed||missing)&&!present.contains(key)){auto row=box->property("scopeRow").toJsonObject();if(missing&&!failed)row["scopeMissing"]=true;rows.append(row);present.insert(key);}}
    while(auto* item=options->takeAt(0)){delete item->widget();delete item;}
    QStringList industryIds;for(auto value:rows){auto row=value.toObject();auto kind=row["scopeKind"].toString(),id=row["id"].toString();auto* box=new QCheckBox(QString(row["scopeMissing"].toBool()?"本次缺项 · ":"")+(kind=="background"?"背景方案 · ":"")+row["title"].toString()+" · "+row["savedAt"].toString()+" · "+id,body);box->setProperty("scopeRow",row);box->setProperty("candidateId",id);box->setProperty("scopeKind",kind);box->setProperty("backgroundArchive",kind=="background");box->setProperty("industryArchive",kind=="industry");box->setChecked(selected.contains(kind+QChar(0)+id));if(kind=="industry")industryIds.append(id);options->addWidget(box);}
    QStringList errors;for(auto value:result["errors"].toArray())errors<<value.toString();for(auto value:rows)if(value.toObject()["scopeMissing"].toBool()){errors<<"原已选范围本次缺失，保留原选择；开始操作时重新完整核验。";break;}setup->setProperty("industryArchiveIds",industryIds);loading->setText(errors.isEmpty()?"选择备份范围；导出时重新核验原始数据。":errors.join("\n")+"\n可继续其它域，未用空值覆盖原库。");
  });
  connect(reloadScope,&QPushButton::clicked,setup,[scopeReader,setup,begin,loading]{setup->setProperty("scopeLoading",true);begin->setEnabled(false);loading->setText("正在刷新备份范围，保留当前选择。");scopeReader->request();});scopeReader->requestCancellable([path=businessStore->filePath()](const PageSnapshotReader::Cancel& cancel){return backupScopeSnapshot(path,cancel);});
  QPointer<QWidget> setupGuard(setup);
  connect(begin,&QPushButton::clicked,this,[this,setupGuard,extra,extraBackground,directory]{
    if(!setupGuard||pages.value("unifiedBackupSetup")!=setupGuard.data()||workspaceTabs->currentWidget()!=setupGuard.data()||!setupGuard->isVisible())return;
    try{
      need(!unifiedBackupLane||!unifiedBackupLane->busy(),"上一操作仍在执行或释放资源");
      QJsonArray ids;QSet<QString> seen;auto add=[&](QString id){if(!id.isEmpty()&&!seen.contains(id)){seen.insert(id);ids.append(id);}};
      QJsonArray backgroundIds;QSet<QString> backgroundSeen;auto addBackground=[&](QString id){if(!id.isEmpty()&&!backgroundSeen.contains(id)){backgroundSeen.insert(id);backgroundIds.append(id);}};
      QStringList industryIds;
      for(auto* box:setupGuard->findChildren<QCheckBox*>())if(box->isChecked()){if(box->property("industryArchive").toBool())industryIds.append(box->property("candidateId").toString());else if(box->property("backgroundArchive").toBool())addBackground(box->property("candidateId").toString());else add(box->property("candidateId").toString());}
      for(auto id:extra->toPlainText().split('\n'))add(id.trimmed());need(ids.size()<=100,"最多明确选择100个冻结结果");
      for(auto id:extraBackground->toPlainText().split('\n'))addBackground(id.trimmed());need(backgroundIds.size()<=100,"最多明确选择100个背景方案");
      Paths paths{watchlistBridgePath(),directory+"/sector-leaders-v1.sqlite",directory+"/recent-v1.sqlite",directory+"/local-candidates-v1.sqlite",directory+"/unified-backup-receipts",directory+"/local-candidate-background-v2.sqlite",businessStore->filePath()};
      QPointer<Window> owner(this);
      auto fresh=[owner]{need(owner&&QThread::currentThread()==owner->thread(),"主自选需在原宿主UI通道读取");return owner->watchlistBridgeCapture()["inputs"].toObject();};
      static QThreadPool* executor=[](){auto* p=new QThreadPool(QCoreApplication::instance());p->setMaxThreadCount(1);return p;}();
      if(unifiedBackupLane)unifiedBackupLane->closeOwner();
      auto lane=std::make_shared<AsyncLane>(QCoreApplication::instance(),executor,fresh);unifiedBackupLane=lane;
      auto save=[owner,fresh,lane](QJsonObject change,QJsonObject inputs){return lane->commitOnUi([owner,fresh,change,inputs]{
        auto current=fresh();need(equal(current,inputs),"确认前主自选输入变化");WatchlistWorkspaceStore::readExisting(owner->watchlistBridgePath(),current);
        auto value=owner->watchlistBridgeStore(false)->save(change,current);owner->renderWatchlistDirectory();owner->fillStocks();return value;
      });};
      auto host=std::make_shared<Host>(paths,"native-0.61",[lane]{return lane->inputs();},save,ids,backgroundIds,industryIds);
      auto target=std::make_shared<QPointer<HostPage>>();
      auto activeTarget=[this,target]{return *target&&pages.value("unifiedBackup")==target->data()&&workspaceTabs->currentWidget()==target->data()&&(*target)->isVisible();};
      Pickers pickers;
      pickers.importFile=[this,target,activeTarget]{if(!activeTarget())return;auto path=QFileDialog::getOpenFileName(this,"选择统一备份",{},"JSON (*.json);;旧产业SQLite (*.sqlite *.db);;全部文件 (*)");if(!*target)return;if(!activeTarget()){(*target)->pickerCancelled();return;}if(path.isEmpty())(*target)->pickerCancelled();else (*target)->acceptImport(path);};
      pickers.newExportFile=[this,target,activeTarget]{if(!activeTarget())return;auto path=QFileDialog::getSaveFileName(this,"另存全新备份文件","统一非敏感备份.json","JSON (*.json)");if(!*target)return;if(!activeTarget()){(*target)->pickerCancelled();return;}if(path.isEmpty())(*target)->pickerCancelled();else (*target)->acceptExport(path);};
      pickers.receiptFile=[this,target,paths,activeTarget]{if(!activeTarget())return;auto path=QFileDialog::getOpenFileName(this,"只读查看原恢复回执",paths.receipts,"恢复回执 (restore-*.json)");if(!*target)return;if(!activeTarget()){(*target)->pickerCancelled();return;}if(path.isEmpty())(*target)->pickerCancelled();else (*target)->acceptReceipt(path);};
      // Explicit new operation replaces only this internal page, keeping every disk receipt.
      if(auto* old=pages.take("unifiedBackup")){workspaceTabs->removeTab(workspaceTabs->indexOf(old));delete old;}
      auto* page=new HostPage(host,lane,pickers,workspaceTabs);*target=page;page->setProperty("workspace","设置");page->setProperty("pageTitle","统一非敏感备份");
      if(setupGuard->property("returnToRecent").toBool()){
        auto* back=new QPushButton("返回最近查看",page);back->setObjectName("unifiedBackupReturnRecent");page->layout()->addWidget(back);
        connect(back,&QPushButton::clicked,this,[this,page]{if(!page->isVisible()||workspaceTabs->currentWidget()!=page||isMinimized()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return;if(auto* recent=qobject_cast<RecentPage*>(pages.value("recent"))){recent->reload();activatePage(recent);}});
      }
      if(setupGuard->property("returnToLeader").toBool()){
        auto* back=new QPushButton("返回人工观察历史",page);back->setObjectName("unifiedBackupReturnLeader");page->layout()->addWidget(back);
        connect(back,&QPushButton::clicked,this,[this,page]{if(!page->isVisible()||workspaceTabs->currentWidget()!=page||isMinimized()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return;if(auto* leader=qobject_cast<SectorLeaderPage*>(pages.value("sectorLeaders")))activatePage(leader);});
      }
      pages["unifiedBackup"]=page;activatePage(page);
    }catch(const std::exception&e){statusBar()->showMessage(QString::fromUtf8(e.what()));}
  });
  setup->setProperty("workspace","设置");setup->setProperty("pageTitle","统一备份范围");pages["unifiedBackupSetup"]=setup;activatePage(setup);
}

QString Window::industryTopicDirectory() const{return QFileInfo(businessStore->filePath()).absolutePath()+"/industry-topics-v1";}
industryTopicUpdate::Runtime* Window::ensureIndustryTopicRuntime(){
 if(!industryTopicRuntime){auto directory=industryTopicDirectory();watchlistWorkspace::need(QDir().mkpath(directory),"产业私有执行目录不可创建");auto business=businessStore->filePath();industryTopicRuntime=new industryTopicUpdate::Runtime(directory+"/state.json",[business]{return businessRestore::Store(business).capture().value("payload").toObject().value("records").toArray();},this);}return industryTopicRuntime;
}
void Window::industryTopicView(){
 auto*p=dynamic_cast<IndustryTopicPage*>(pages.value("industryTopic"));if(!p){auto runtime=ensureIndustryTopicRuntime();auto business=businessStore->filePath();p=new IndustryTopicPage(industryTopicDirectory(),runtime,[business]{return businessRestore::Store(business).capture().value("payload").toObject().value("records").toArray();},workspaceTabs);p->setProperty("workspace","研究");p->setProperty("pageTitle","产业主题更新");p->exportRequested=[this](QString name,QString text){auto path=QFileDialog::getSaveFileName(this,"保存完整产业原件",name);if(path.isEmpty())return;QSaveFile out(path);out.setDirectWriteFallback(false);auto bytes=text.toUtf8();watchlistWorkspace::need(out.open(QIODevice::WriteOnly)&&out.write(bytes)==bytes.size()&&out.commit(),"完整产业原件未保存");};pages["industryTopic"]=p;}activatePage(p);bool foreground=QGuiApplication::applicationState()==Qt::ApplicationActive&&!isMinimized();p->setActive(foreground);if(foreground)ensureIndustryTopicRuntime()->start();
}
void Window::changeEvent(QEvent*event){QMainWindow::changeEvent(event);if(event->type()==QEvent::WindowStateChange&&isMinimized()&&feed)feed->cancelCapitalDay();if(event->type()==QEvent::WindowStateChange&&industryTopicRuntime){if(isMinimized())industryTopicRuntime->stop();else if(QGuiApplication::applicationState()==Qt::ApplicationActive)industryTopicRuntime->start();if(auto*p=dynamic_cast<IndustryTopicPage*>(pages.value("industryTopic")))p->setActive(!isMinimized()&&p->isVisible()&&QGuiApplication::applicationState()==Qt::ApplicationActive);}}

void Window::publicPriceDetailView(){
  try{
    auto* page=dynamic_cast<PublicPriceDetailPage*>(pages.value("publicPriceDetails"));
    if(!page){
      page=new PublicPriceDetailPage(QFileInfo(businessStore->filePath()).absolutePath()+"/public-price-detail-legacy-v1.sqlite",workspaceTabs);
      page->setProperty("workspace","主页");page->setProperty("pageTitle","历史报价记录");page->setProperty("workbenchChild",true);
      auto* back=new QPushButton("← 返回看盘（Esc）",page);back->setObjectName("publicPriceBack");
      qobject_cast<QVBoxLayout*>(page->layout())->insertWidget(0,back,0,Qt::AlignLeft);
      auto* hint=new QLabel("历史报价记录 · 查看以前保存的报价，不是实时逐笔成交；没有保存的日期不会补造数据。",page);hint->setWordWrap(true);
      qobject_cast<QVBoxLayout*>(page->layout())->insertWidget(1,hint);
      connect(back,&QPushButton::clicked,this,&Window::home);pages["publicPriceDetails"]=page;
    }
    page->setInstrument(activeId);activatePage(page);
  }catch(const std::exception&e){statusBar()->showMessage(QString::fromUtf8(e.what()));}
}
