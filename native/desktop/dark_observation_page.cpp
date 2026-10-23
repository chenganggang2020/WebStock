#include "dark_observation_page.hpp"
#include "dark_observation_curve.hpp"
#include <QtWidgets>
namespace {
QString now() {
  return QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);
}
QString amount(QJsonValue v) {
  if (!v.isString())
    return "未知";
  auto digits=v.toString();if(!QRegularExpression("^-?[0-9]{1,22}$").match(digits).hasMatch())return "未知";bool negative=digits.startsWith('-');if(negative)digits.remove(0,1);while(digits.size()>1&&digits.startsWith('0'))digits.remove(0,1);digits=digits.rightJustified(3,'0');return (negative&&digits!="000"?"-":"")+digits.left(digits.size()-2)+"."+digits.right(2);
}
QString quality(QJsonObject r) {
  return r.value("reconciled").isNull()  ? "缺数"
         : r.value("reconciled") == true ? "对账一致"
                                         : "对账不符";
}
template <class F> void deliver(QPointer<DarkObservationPage> weak, F done) {
  QMetaObject::invokeMethod(
      QCoreApplication::instance(),
      [weak, done] {
        if (weak)
          done(weak.data());
      },
      Qt::QueuedConnection);
}
} // namespace
DarkObservationPage::DarkObservationPage(QString dir, QWidget *parent)
    : QWidget(parent), directory(std::move(dir)) {
  setObjectName("darkObservationPage");
  auto root = new QVBoxLayout(this);
  auto bar = new QHBoxLayout;
  root->addLayout(bar);
  auto button = [&](QString title, QString name) {
    auto b = new QPushButton(title);
    b->setObjectName(name);
    bar->addWidget(b);
    return b;
  };
  auto back = button("返回明暗盘榜", "darkObservationBack");
  preview = button("预览保存完整快照", "darkObservationPreview");
  confirm = button("确认保存", "darkObservationConfirm");
  auto stop = button("取消预览 / 任务", "darkObservationCancel");
  auto notice =
      new QLabel("本机观察 · "
                 "只保存进入本页时已持有的完整日期榜单。原交易日、逐行接收时间"
                 "和来源原样保留；历史日榜单的后续接收不代表该日盘中采样。源时"
                 "刻未知，多页非同步快照；没有自动采集。");
  notice->setWordWrap(true);
  root->addWidget(notice);
  status = new QLabel("尚未预览；取消预览不会写入");
  status->setObjectName("darkObservationStatus");
  status->setWordWrap(true);
  root->addWidget(status);
  auto query = new QHBoxLayout;
  root->addLayout(query);
  key = new QLineEdit;
  key->setObjectName("darkObservationKey");
  key->setPlaceholderText("完整证券身份，如 sh600000");
  key->setMaxLength(48);
  day = new QLineEdit;
  day->setObjectName("darkObservationDay");
  day->setPlaceholderText("真实交易日 yyyy-MM-dd");
  day->setMaxLength(10);
  query->addWidget(key);
  query->addWidget(day);
  read = new QPushButton("读取本机观察");
  read->setObjectName("darkObservationRead");
  query->addWidget(read);
  auto* legacyChoices=new QHBoxLayout;root->addLayout(legacyChoices);legacyChoices->addWidget(new QLabel("旧已存观察（原件重复保留，按身份去重显示）"));auto* legacyStock=new QComboBox(this);legacyStock->setObjectName("darkObservationLegacyStock");auto* legacyDay=new QComboBox(this);legacyDay->setObjectName("darkObservationLegacyDay");legacyDay->setMinimumWidth(150);legacyChoices->addWidget(legacyStock,1);legacyChoices->addWidget(legacyDay);
  auto clearSelection=[this]{cancel();captured={};points={};table->setRowCount(0);from->clear();to->clear();detail->clear();if(auto* curve=findChild<QWidget*>("darkObservationCurve"))static_cast<DarkObservationCurve*>(curve)->setPoints({});comparison->setText("请读取所选旧记录；没有连续采样的不补造");busy(false);};
  connect(legacyStock,&QComboBox::activated,this,[this,legacyStock,legacyDay,clearSelection](int index){if(!activePage()||index<1)return;clearSelection();key->setText(legacyStock->currentData().toString());day->clear();QSignalBlocker block(legacyDay);legacyDay->clear();legacyDay->addItem("选择原交易日","");for(auto d:legacyStock->currentData(Qt::UserRole+1).toStringList())legacyDay->addItem(d,d);status->setText("旧证券已选，请明确原交易日再读取；不会保存当前榜单");});
  connect(legacyDay,&QComboBox::activated,this,[this,legacyDay,clearSelection](int index){if(!activePage()||index<1)return;clearSelection();day->setText(legacyDay->currentData().toString());status->setText("已选择旧证券和原交易日；点击读取本机观察，不会请求或重算");});
  table = new QTableWidget(0, 7);
  table->setObjectName("darkObservationTable");
  table->setHorizontalHeaderLabels({"本行原接收时刻", "暗盘净额 / 元",
                                    "明盘净额 / 元", "合计 / 元", "金额质量",
                                    "本机保存时刻", "观察ID"});
  table->setEditTriggers(QAbstractItemView::NoEditTriggers);
  table->setSelectionBehavior(QAbstractItemView::SelectRows);
  table->setSelectionMode(QAbstractItemView::SingleSelection);
  table->horizontalHeader()->setSectionResizeMode(
      QHeaderView::ResizeToContents);
  root->addWidget(table, 2);
  root->addWidget(new DarkObservationCurve(this),1);
  auto choices = new QHBoxLayout;
  root->addLayout(choices);
  choices->addWidget(new QLabel("比较两条保存记录"));
  from = new QComboBox;
  to = new QComboBox;
  from->setObjectName("darkObservationFrom");
  to->setObjectName("darkObservationTo");
  choices->addWidget(from, 1);
  choices->addWidget(to, 1);
  auto compare = new QPushButton("比较净额变化");
  compare->setObjectName("darkObservationCompare");
  choices->addWidget(compare);
  comparison = new QLabel("差值只表示同来源模型净额变化；缺失不是零。");
  comparison->setObjectName("darkObservationComparison");
  comparison->setWordWrap(true);
  root->addWidget(comparison);
  detail = new QPlainTextEdit;
  detail->setReadOnly(true);
  detail->setObjectName("darkObservationDetail");
  detail->setMaximumHeight(150);
  root->addWidget(detail, 1);
  connect(back, &QPushButton::clicked, this, [this] {
    if (!activePage()) return;
    cancel();
    emit backRequested();
  });
  connect(stop, &QPushButton::clicked, this, [this] {
    if (!activePage()) return;
    cancel();
    status->setText("已取消未提交任务和预览；此前已提交的观察保留，请读取确认");
  });
  connect(preview, &QPushButton::clicked, this, &DarkObservationPage::prepare);
  connect(confirm, &QPushButton::clicked, this, &DarkObservationPage::append);
  connect(read, &QPushButton::clicked, this, &DarkObservationPage::load);
  connect(compare, &QPushButton::clicked, this,
          &DarkObservationPage::showComparison);
  connect(table, &QTableWidget::itemSelectionChanged, this, [this] {
    int i = table->currentRow();
    if (i >= 0 && i < points.size())
      detail->setPlainText(QString::fromUtf8(
          QJsonDocument(points[i].toObject()).toJson(QJsonDocument::Indented)));
  });
  busy(false);
  connect(qApp, &QGuiApplication::applicationStateChanged, this, [this](Qt::ApplicationState state) {
    if (state != Qt::ApplicationActive) cancel();
  });
}
DarkObservationPage::~DarkObservationPage() { cancel(); }
void DarkObservationPage::hideEvent(QHideEvent *e) {
  cancel();
  QWidget::hideEvent(e);
}
bool DarkObservationPage::activePage() const {
  return isVisible() && !window()->isMinimized() && QGuiApplication::applicationState() == Qt::ApplicationActive;
}
void DarkObservationPage::busy(bool value) {
  preview->setEnabled(!value && !captured.isEmpty());
  read->setEnabled(!value);
  confirm->setEnabled(!value && bool(pending));
  key->setEnabled(!value);
  day->setEnabled(!value);
  if(auto* choices=findChild<QComboBox*>("darkObservationLegacyStock"))choices->setEnabled(!value);
  if(auto* choices=findChild<QComboBox*>("darkObservationLegacyDay"))choices->setEnabled(!value);
}
void DarkObservationPage::cancel() {
  ++generation;
  cancelled->store(true);
  cancelled = std::make_shared<std::atomic_bool>(false);
  pending.reset();
  revision.clear();
  busy(false);
}
void DarkObservationPage::openCaptured(QJsonObject snapshot, QString selected,
                                       QString date) {
  cancel();
  captured = std::move(snapshot);
  key->setText(selected);
  day->setText(date);
  points = {};
  table->setRowCount(0);
  from->clear();
  to->clear();
  detail->clear();
  comparison->setText(
      "请选择同证券、同真实交易日的两条记录；源时间未知，多页非同步。");
  status->setText(captured.isEmpty()
                      ? "当前没有完整日期快照；可读取已经保存的观察"
                      : "已持有交易日 " +
                            captured.value("tradingDay").toString() +
                            " 的完整榜单；预览后还需明确确认保存。");
  busy(false);
  if(auto* curve=findChild<QWidget*>("darkObservationCurve"))static_cast<DarkObservationCurve*>(curve)->setPoints({});
  auto token=generation;auto flag=cancelled;auto dir=directory;QPointer<DarkObservationPage> weak(this);
  QThreadPool::globalInstance()->start([weak,token,flag,dir]{QJsonObject catalog;QString error;try{catalog=darkObservation::legacyCatalog(dir,[flag]{return flag->load();});}catch(const std::exception& e){error=QString::fromUtf8(e.what());}deliver(weak,[token,catalog,error](auto v){if(token!=v->generation||!v->activePage())return;auto* stocks=v->template findChild<QComboBox*>("darkObservationLegacyStock");auto* dates=v->template findChild<QComboBox*>("darkObservationLegacyDay");QSignalBlocker a(stocks),b(dates);stocks->clear();dates->clear();stocks->addItem("选择旧证券","");dates->addItem("选择原交易日","");for(auto value:catalog.value("stocks").toArray()){auto row=value.toObject();stocks->addItem(row.value("name").toString()+" / "+row.value("key").toString(),row.value("key").toString());QStringList days;for(auto d:row.value("dates").toArray())days.append(d.toString());stocks->setItemData(stocks->count()-1,days,Qt::UserRole+1);}if(!error.isEmpty())v->status->setText("旧观察目录未通过核验："+error+"；原文件保留");});});
}
void DarkObservationPage::prepare() {
  if (!activePage()) return;
  cancel();
  auto token = generation;
  auto flag = cancelled;
  auto data = captured;
  auto dir = directory;
  auto at = now();
  busy(true);
  status->setText("后台核验完整快照和观察仓，尚未写入…");
  QPointer<DarkObservationPage> weak(this);
  QThreadPool::globalInstance()->start([weak, token, flag, data, dir, at] {
    std::shared_ptr<const darkObservation::Prepared> p;
    QJsonObject preview;
    QString error;
    try {
      auto stop = [flag] { return flag->load(); };
      p = std::make_shared<const darkObservation::Prepared>(
          darkObservation::prepare(data, at, stop));
      preview = darkObservation::Store(dir).preview(*p, stop);
    } catch (const std::exception &e) {
      error = QString::fromUtf8(e.what());
    }
    deliver(weak, [token, p, preview, error](auto v) {
      if (token != v->generation || !v->activePage())
        return;
      v->pending = error.isEmpty() ? p : nullptr;
      v->revision = preview.value("expectedRevision").toString();
      v->busy(false);
      v->status->setText(
          error.isEmpty() ? QString("保存预览：交易日 %1 · 完整 %2 行 · "
                                    "缺数/对账待核 %3 行\n原扫描 %4 → "
                                    "%5；源时刻未知，多页非同步。%"
                                    "6\n仅“确认保存”写入；本机保存时间另记。")
                                .arg(preview.value("tradingDay").toString())
                                .arg(preview.value("rowCount").toInt())
                                .arg(preview.value("uncertainRows").toInt())
                                .arg(preview.value("scanStartedAt").toString(),
                                     preview.value("receivedAt").toString(),
                                     preview.value("duplicate").toBool()
                                         ? "相同内容已存，将保留原记录。"
                                         : "将新增一份不可变完整快照。")
                          : "预览不可用，未写入：" + error);
    });
  });
}
void DarkObservationPage::append() {
  if (!activePage()) return;
  if (!pending)
    return;
  auto p = pending;
  auto expected = revision;
  cancel();
  auto token = generation;
  auto flag = cancelled;
  auto dir = directory;
  auto at = now();
  busy(true);
  status->setText("正在后台保存已确认的完整快照…");
  QPointer<DarkObservationPage> weak(this);
  QThreadPool::globalInstance()->start([weak, token, flag, p, expected, dir,
                                        at] {
    QJsonObject result;
    QString error;
    try {
      result = darkObservation::Store(dir).append(
          *p, expected, at, [flag] { return flag->load(); });
    } catch (const std::exception &e) {
      error = QString::fromUtf8(e.what());
    }
    deliver(weak, [token, result, error](auto v) {
      if (token != v->generation || !v->activePage())
        return;
      v->busy(false);
      v->status->setText(
          error.isEmpty()
              ? (result.value("status") == "duplicate"
                     ? "相同快照已存，未覆盖；原保存时间 "
                     : "完整快照已保存；本机保存时间 ") +
                    result.value("savedAt").toString() + "。请读取本机观察。"
              : "未完成保存：" + error + "；请读取核对已提交记录");
    });
  });
}
void DarkObservationPage::load() {
  if (!activePage()) return;
  cancel();
  auto token = generation;
  auto flag = cancelled;
  auto dir = directory;
  auto k = key->text().trimmed(), d = day->text().trimmed();
  busy(true);
  status->setText("后台读取并核验全部已存观察…");
  QPointer<DarkObservationPage> weak(this);
  QThreadPool::globalInstance()->start([weak, token, flag, dir, k, d] {
    QJsonObject result;
    QString error;
    try {
      result = darkObservation::Store(dir).read(
          k, d, [flag] { return flag->load(); });
    } catch (const std::exception &e) {
      error = QString::fromUtf8(e.what());
    }
    deliver(weak, [token, result, error](auto v) {
      if (token != v->generation || !v->activePage())
        return;
      v->busy(false);
      if (error.isEmpty())
        v->render(result);
      else {
        v->points = {};
        v->table->setRowCount(0);
        if(auto* curve=v->template findChild<QWidget*>("darkObservationCurve"))static_cast<DarkObservationCurve*>(curve)->setPoints({});
        v->from->clear();
        v->to->clear();
        v->detail->clear();
        v->comparison->setText("当前读取未通过核验，不能比较");
        v->status->setText("读取被阻断；原文件保留：" + error);
      }
    });
  });
}
void DarkObservationPage::render(QJsonObject history) {
  points = history.value("points").toArray();
  if(auto* curve=findChild<QWidget*>("darkObservationCurve"))static_cast<DarkObservationCurve*>(curve)->setPoints(points);
  table->setRowCount(0);
  from->clear();
  to->clear();
  detail->clear();
  comparison->setText("选择两条记录后比较；未知金额不会补零。");
  for (int i = 0; i < points.size(); i++) {
    auto p = points[i].toObject(), r = p.value("row").toObject();
    QStringList values{r.value("receivedAt").toString(),
                       amount(r.value("darkNetCents")),
                       amount(r.value("visibleNetCents")),
                       amount(r.value("combinedNetCents")),
                       p.value("provenance")=="legacy-local-observation"?QString("原值相加一致，非行情核验"):quality(r),
                       p.value("savedAt").isString()?p.value("savedAt").toString():QString("旧记录未提供"),
                       p.value("id").toString()};
    table->insertRow(i);
    for (int c = 0; c < values.size(); c++) {
      auto item = new QTableWidgetItem(values[c]);
      item->setToolTip(values[c]);
      if(c>=1&&c<=3)item->setData(Qt::UserRole,r.value(QStringList{"darkNetCents","visibleNetCents","combinedNetCents"}[c-1]).toString());
      table->setItem(i, c, item);
    }
    auto label = QString::number(i + 1) + " · " + values[0] + " · " +
                 p.value("id").toString().left(8);
    from->addItem(label);
    to->addItem(label);
  }
  if (points.size()) {
    table->selectRow(0);
    from->setCurrentIndex(std::max(0, int(points.size()) - 2));
    to->setCurrentIndex(points.size() - 1);
  }
  QStringList dates;
  for (auto d : history.value("availableDates").toArray())
    dates.append(d.toString());
  status->setText(
      QString(
          "%1 · 交易日 %2 · 实际保存 %3 条，未覆盖或裁剪。仓内交易日：%4\n%5")
          .arg(history.value("key").toString(),
               history.value("tradingDay").toString())
          .arg(points.size())
          .arg(dates.isEmpty() ? "无" : dates.join("、"),
               history.value("note").toString()));
  auto old=history.value("legacySummary").toObject();if(old.value("rawRows").toInt())status->setText(status->text()+QString("\n旧原件 %1 批 / %2 行；%3 条相同观察重复完整保留在原件，唯一身份点 %4；非真实暗盘成交，未自动采样。审计冲突原件 %5。 ").arg(old.value("rawBatches").toInt()).arg(old.value("rawRows").toInt()).arg(old.value("identicalSourceDuplicates").toInt()).arg(old.value("sourceUniquePoints").toInt()).arg(old.value("sourceConflicts").toInt()));
}
void DarkObservationPage::showComparison() {
  if (!activePage()) return;
  int a = from->currentIndex(), b = to->currentIndex();
  if (a < 0 || b < 0 || a >= points.size() || b >= points.size()) {
    comparison->setText("至少需两条保存记录；缺记录不是零");
    return;
  }
  auto result =
      darkObservation::compare(points[a].toObject(), points[b].toObject());
  comparison->setText(
      result.value("status") == "compared"
          ? QString("模型净额变化 / 元：暗盘 %1 · 明盘 %2 · 合计 %3。%4%5")
                .arg(amount(result.value("darkNetChangeCents")),
                     amount(result.value("visibleNetChangeCents")),
                     amount(result.value("combinedNetChangeCents")),
                     result.value("reason").toString(),
                     result.value("gapOverTenMinutes").toBool()
                         ? "；间隔超过10分钟，不能视为连续观测"
                         : "；多页非同步")
          : "不可比较，差值未知：" + result.value("reason").toString());
}
