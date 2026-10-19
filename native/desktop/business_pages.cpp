#include "business_pages.hpp"
#include "business_read_request.hpp"

#include <QComboBox>
#include <QDateEdit>
#include <QDoubleSpinBox>
#include <QFileDialog>
#include <QFormLayout>
#include <QHeaderView>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSaveFile>
#include <QShowEvent>
#include <QSignalBlocker>
#include <QSplitter>
#include <QTabWidget>
#include <QTableWidget>
#include <QThread>
#include <QTimer>
#include <QVBoxLayout>
#include <QFutureWatcher>
#include <QPromise>
#include <QThreadPool>

#include "legacy_data.hpp"
#include "industry_page.hpp"
#include "creator_page.hpp"
namespace {
class RestorePreviewWidget : public QWidget {
 public:
  using QWidget::QWidget;
  std::function<void(const QJsonObject&)> stage;
  std::function<void()> guard;
};
class BusinessWidget : public QWidget {
 public:
  using QWidget::QWidget;
  std::function<void()> refresh;
  std::function<void(const QJsonObject&)> openRecord;

 protected:
  void showEvent(QShowEvent* e) override {
    QWidget::showEvent(e);
    if (refresh) refresh();
  }
};
QPushButton* button(QBoxLayout* l, const QString& label, const QString& id) {
  auto* b = new QPushButton(label);
  b->setObjectName(id);
  l->addWidget(b);
  return b;
}
QTableWidget* table(const QStringList& headers, QWidget* parent) {
  auto* t = new QTableWidget(0, headers.size(), parent);
  t->setHorizontalHeaderLabels(headers);
  t->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
  t->verticalHeader()->hide();
  t->setEditTriggers(QAbstractItemView::NoEditTriggers);
  t->setSelectionBehavior(QAbstractItemView::SelectRows);
  return t;
}
QString n(QJsonValue v) {
  return v.isDouble() ? QString::number(v.toDouble(), 'f', 2) : "—";
}
void fill(QTableWidget* t, const QJsonArray& rows, const QStringList& keys) {
  t->setRowCount(rows.size());
  for (int i = 0; i < rows.size(); i++)
    for (int k = 0; k < keys.size(); k++) {
      const QJsonValue v = rows[i].toObject().value(keys[k]);
      auto* item = new QTableWidgetItem(v.isString() ? v.toString() : n(v));
      item->setData(Qt::UserRole, rows[i]);
      t->setItem(i, k, item);
    }
}
}  // namespace
QWidget* portfolioPage(std::shared_ptr<BusinessStore> store, bool paper,
                       std::function<QJsonArray()> roster,
                       std::function<void(QString)> open, QWidget* parent) {
  auto* page = new BusinessWidget(parent);
  page->setObjectName(paper ? "paperPage" : "portfolioPage");
  auto* l = new QVBoxLayout(page);
  auto* tools = new QHBoxLayout;
  l->addLayout(tools);
  tools->addWidget(new QLabel(paper ? "纸面模拟 · 手动记录，无券商委托"
                                    : "自选与账户 · 手动账本"));
  auto* accounts = new QComboBox;
  accounts->setObjectName("ledgerAccount");
  tools->addWidget(accounts);
  auto accountRows=std::make_shared<QJsonArray>();
  auto loadAccounts = [=](QString wanted) {
    QSignalBlocker blocked(accounts);
    accounts->clear();
    for (auto v : *accountRows) {
      auto a = v.toObject();
      if ((a["type"] == "paper") == paper)
        accounts->addItem(a["name"].toString(), a["id"].toString());
    }
    int i = accounts->findData(wanted);
    if (i >= 0) accounts->setCurrentIndex(i);
  };
  auto* accountName = new QLineEdit;
  accountName->setPlaceholderText("新账户名称");
  tools->addWidget(accountName);
  auto* addAccount = button(tools, "新建账户", "createAccount");
  tools->addStretch();
  auto* state = new QLabel(
      "账户与纸面账本分开保存 · 缺失报价不参与估值");
  state->setWordWrap(true);
  state->setObjectName("ledgerState");
  l->addWidget(state);
  auto* summary = new QLabel;
  summary->setObjectName("ledgerSummary");
  l->addWidget(summary);
  auto* split = new QSplitter(Qt::Horizontal);
  l->addWidget(split, 1);
  auto* tabs = new QTabWidget;
  tabs->setObjectName("ledgerViews");
  split->addWidget(tabs);
  auto* positions = table({"标的", "名称", "股数", "持仓成本", "市值",
                           "浮动盈亏", "已实现盈亏", "行情日期"},
                          tabs);
  positions->setObjectName("positionTable");
  tabs->addTab(positions, "持仓 / 已清仓");
  auto* trades = table(
      {"日期", "标的", "方向", "股数", "价格", "费用", "税", "备注"}, tabs);
  trades->setObjectName("tradeTable");
  tabs->addTab(trades, "流水");
  auto* history = new QWidget;
  auto* historyLayout = new QVBoxLayout(history);
  auto* snapshots =
      table({"记录日期", "总资产", "现金", "市值", "累计盈亏"}, history);
  snapshots->setObjectName("legacySnapshotTable");
  historyLayout->addWidget(snapshots, 1);
  auto* snapshotText = new QPlainTextEdit;
  snapshotText->setReadOnly(true);
  snapshotText->setObjectName("legacySnapshotText");
  historyLayout->addWidget(snapshotText, 1);
  tabs->addTab(history, "旧账本快照（原记录）");
  QObject::connect(
      snapshots, &QTableWidget::cellClicked, page, [=](int r, int) {
        auto raw =
            snapshots->item(r, 0)->data(Qt::UserRole).toJsonValue().toObject();
        snapshotText->setPlainText(
            QString::fromUtf8(QJsonDocument(raw).toJson()));
      });
  auto* edit = new QWidget;
  edit->setMinimumWidth(240);
  edit->setMaximumWidth(340);
  split->addWidget(edit);
  auto* form = new QFormLayout(edit);
  auto* editorTitle = new QLabel("新增记录");
  form->addRow(editorTitle);
  auto* symbols = new QComboBox;
  symbols->setObjectName("tradeInstrument");
  for (auto v : roster()) {
    auto s = v.toObject();
    QString id = s["id"].toString();
    if (id.contains(":stock:") || id.contains(":etf:"))
      symbols->addItem(s["name"].toString() + " " + s["symbol"].toString(), id);
  }
  form->addRow("标的", symbols);
  auto* date = new QDateEdit(QDate::currentDate());
  date->setDisplayFormat("yyyy-MM-dd");
  date->setCalendarPopup(true);
  date->setObjectName("tradeDate");
  form->addRow("日期", date);
  auto* side = new QComboBox;
  side->setObjectName("tradeSide");
  for (auto pair : {qMakePair("买入", "buy"), qMakePair("卖出", "sell"),
                    qMakePair("分红", "dividend"), qMakePair("费用", "fee")})
    side->addItem(pair.first, pair.second);
  form->addRow("方向", side);
  auto spin = [&](QString label, QString id, int decimals, double max) {
    auto* s = new QDoubleSpinBox;
    s->setObjectName(id);
    s->setDecimals(decimals);
    s->setRange(0, max);
    s->setKeyboardTracking(false);
    form->addRow(label, s);
    return s;
  };
  auto* qty = spin("股数", "tradeQuantity", 0, 1e9);
  qty->setValue(100);
  auto* price = spin("单价 / 每股分红", "tradePrice", 4, 1e7);
  auto* fee = spin("手续费 / 独立费用", "tradeFee", 4, 1e9);
  auto* tax = spin("税费（卖出）", "tradeTax", 4, 1e9);
  auto* amount = spin("分红 / 独立费用总额", "tradeAmount", 2, 1e12);
  auto* note = new QLineEdit;
  note->setObjectName("tradeNote");
  form->addRow("备注", note);
  auto* save = new QPushButton("保存记录");
  save->setObjectName("saveTrade");
  form->addRow(save);
  auto* reset = new QPushButton("转为新增");
  reset->setObjectName("newTrade");
  form->addRow(reset);
  auto* erase = new QPushButton("删除选中记录");
  erase->setObjectName("deleteTrade");
  form->addRow(erase);
  auto selected = std::make_shared<QString>();
  auto original = std::make_shared<QJsonObject>();
  auto* reads=new BusinessReadRequest(store->filePath(),page);
  auto ready=std::make_shared<bool>(false);
  auto cached=std::make_shared<QJsonObject>();
  auto offsets=std::make_shared<QMap<int,int>>();
  auto* pages=new QHBoxLayout;l->addLayout(pages);auto* previous=new QPushButton("上一页");previous->setObjectName("ledgerPrevious");auto* pageState=new QLabel;auto* next=new QPushButton("下一页");next->setObjectName("ledgerNext");pages->addWidget(previous);pages->addWidget(pageState,1);pages->addWidget(next);
  auto paint=[=]{
    auto portfolio=cached->value("portfolio").toObject();auto pos=portfolio["positions"].toArray(),all=cached->value("trades").toArray(),old=cached->value("snapshots").toArray();
    auto slice=[=](QJsonArray rows,int view){int start=qBound(0,offsets->value(view),qMax(0,((int(rows.size())-1)/100)*100));(*offsets)[view]=start;QJsonArray out;for(int i=start;i<qMin(start+100,int(rows.size()));++i)out.append(rows[i]);return out;};
    fill(positions,slice(pos,0),{"instrumentId","name","quantity","cost","marketValue","unrealized","realized","quoteDate"});
    fill(trades,slice(all,1),{"date","instrumentId","side","quantity","price","fee","tax","note"});
    fill(snapshots,slice(old,2),{"snapshot_date","total_assets","cash_balance","total_market_value","total_pnl"});
    int view=tabs->currentIndex(),count=view==0?pos.size():view==1?all.size():old.size(),start=offsets->value(view);previous->setEnabled(start>0);next->setEnabled(start+100<count);pageState->setText(QString("完整 %1 条 · 第%2/%3页").arg(count).arg(start/100+1).arg(qMax(1,(count+99)/100)));
  };
  QObject::connect(previous,&QPushButton::clicked,page,[=]{int view=tabs->currentIndex();(*offsets)[view]=qMax(0,offsets->value(view)-100);paint();});
  QObject::connect(next,&QPushButton::clicked,page,[=]{int view=tabs->currentIndex();(*offsets)[view]=offsets->value(view)+100;paint();});
  QObject::connect(tabs,&QTabWidget::currentChanged,page,[=]{paint();});
  save->setEnabled(false);erase->setEnabled(false);addAccount->setEnabled(false);
  auto render = [=] {
    // Capture GUI-owned roster here, never inside the worker.
    QJsonObject quotes;for(auto value:roster()){auto row=value.toObject();quotes[row["id"].toString()]=row["quote"];}
    auto account=accounts->currentData().toString();if(account.isEmpty())account=paper?"paper":"local";
    reads->submit({{"operation","ledger"},{"account",account},{"paper",paper},{"initial",!*ready},{"quotes",quotes}});
  };
  reads->completed=[=](QJsonObject result){
    if(!result["error"].toString().isEmpty()){state->setText(result["error"].toString()+"；原结果和编辑内容保留，可重试");return;}
    auto previousAccount=accounts->currentData().toString();*accountRows=result["accounts"].toArray();loadAccounts(result["account"].toString());
    if(!previousAccount.isEmpty()&&previousAccount!=accounts->currentData().toString()){selected->clear();editorTitle->setText("新增记录");}
    *cached=result;const auto p=result["portfolio"].toObject();
    summary->setText(QString("持仓成本 %1　市值 %2　浮盈 %3　已实现 %4　费用 %5　流水 %6条").arg(n(p["cost"]),n(p["marketValue"]),n(p["unrealized"]),n(p["realized"]),n(p["fees"])).arg(p["tradeCount"].toInt()));
    paint();*ready=true;page->setProperty("ledgerReady",true);save->setEnabled(accounts->count()>0);erase->setEnabled(accounts->count()>0);addAccount->setEnabled(true);
  };
  QObject::connect(save, &QPushButton::clicked, page, [=] {
    try {
      business::require(symbols->currentIndex() >= 0,
                        "请先添加股票或ETF到自选");
      QJsonObject update{{"id", *selected},
                         {"accountId", accounts->currentData().toString()},
                         {"instrumentId", symbols->currentData().toString()},
                         {"name", symbols->currentText().section(' ', 0, 0)},
                         {"date", date->date().toString(Qt::ISODate)},
                         {"side", side->currentData().toString()},
                         {"quantity", qty->value()},
                         {"price", price->value()},
                         {"fee", fee->value()},
                         {"tax", tax->value()},
                         {"note", note->text()}};
      auto item = selected->isEmpty() ? QJsonObject() : *original;
      for (auto it = update.begin(); it != update.end(); ++it)
        item[it.key()] = it.value();
      if (side->currentData() == "dividend" || side->currentData() == "fee")
        item["amount"] = amount->value();
      else
        item.remove("amount");
      store->save("trades", item);
      selected->clear();
      editorTitle->setText("新增记录");
      state->setText("已保存至本机业务库");
      render();
    } catch (const std::exception& e) {
      state->setText("未保存：" + QString::fromUtf8(e.what()));
    }
  });
  QObject::connect(trades, &QTableWidget::cellClicked, page, [=](int row, int) {
    auto t = trades->item(row, 0)->data(Qt::UserRole).toJsonValue().toObject();
    *selected = t["id"].toString();
    *original = t;
    editorTitle->setText("编辑已有记录");
    if (symbols->findData(t["instrumentId"].toString()) < 0)
      symbols->addItem(
          t["name"].toString() + " " + t["instrumentId"].toString(),
          t["instrumentId"].toString());
    symbols->setCurrentIndex(symbols->findData(t["instrumentId"].toString()));
    date->setDate(QDate::fromString(t["date"].toString(), Qt::ISODate));
    side->setCurrentIndex(side->findData(t["side"].toString()));
    qty->setValue(t["quantity"].toDouble());
    price->setValue(t["price"].toDouble());
    fee->setValue(t["fee"].toDouble());
    tax->setValue(t["tax"].toDouble());
    amount->setValue(t["amount"].toDouble(
        t["side"] == "fee" ? t["fee"].toDouble()
                           : t["price"].toDouble() * t["quantity"].toDouble()));
    note->setText(t["note"].toString());
  });
  QObject::connect(reset, &QPushButton::clicked, page, [=] {
    selected->clear();
    editorTitle->setText("新增记录");
  });
  QObject::connect(erase, &QPushButton::clicked, page, [=] {
    if (selected->isEmpty()) return;
    if (QMessageBox::question(
            page, "删除记录",
            "删除后将重新计算此账户；无法满足持仓约束时会拒绝删除。") !=
        QMessageBox::Yes)
      return;
    try {
      store->remove("trades", *selected);
      selected->clear();
      render();
    } catch (const std::exception& e) {
      state->setText(QString::fromUtf8(e.what()));
    }
  });
  QObject::connect(accounts, &QComboBox::currentIndexChanged, page, [=] {
    selected->clear();
    editorTitle->setText("新增记录");
    render();
  });
  QObject::connect(addAccount, &QPushButton::clicked, page, [=] {
    try {
      auto a = store->save("accounts", {{"name", accountName->text()},
                                        {"type", paper ? "paper" : "ledger"}});
      accountRows->append(a);loadAccounts(a["id"].toString());
      selected->clear();
      editorTitle->setText("新增记录");
      accountName->clear();
      render();
    } catch (const std::exception& e) {
      state->setText(QString::fromUtf8(e.what()));
    }
  });
  QObject::connect(
      positions, &QTableWidget::cellDoubleClicked, page,
      [=](int row, int) { open(positions->item(row, 0)->text()); });
  auto* refresh = button(tools, "重算 / 读取已取得行情", "revalueAccount");
  QObject::connect(refresh, &QPushButton::clicked, page, render);
  page->refresh = render;
  split->setSizes({950, 290});
  return page;
}
static QWidget* evidencePage(std::shared_ptr<BusinessStore> store, QWidget* parent) {
  auto* page = new BusinessWidget(parent);
  page->setObjectName("researchPage");
  auto* l = new QVBoxLayout(page);
  auto* tools = new QHBoxLayout;
  l->addLayout(tools);
  auto* search = new QLineEdit;
  search->setPlaceholderText("搜索标题、主题、正文");
  tools->addWidget(search);
  auto* fresh = button(tools, "新资料", "newEvidence");
  auto* imports = button(tools, "导入TXT / Markdown", "importEvidence");
  auto* save = button(tools, "保存资料", "saveEvidence");
  auto* reload = button(tools, "重读列表", "reloadEvidence");
  auto* discard = button(tools, "放弃未保存修改", "discardEvidenceDraft");
  auto* state = new QLabel("原文、笔记与核验记录");
  state->setWordWrap(true);
  state->setObjectName("evidenceState");
  l->addWidget(state);
  auto* split = new QSplitter;
  l->addWidget(split, 1);
  auto* list = new QListWidget;
  list->setObjectName("evidenceList");
  split->addWidget(list);
  auto* pane = new QWidget;
  split->addWidget(pane);
  auto* right = new QVBoxLayout(pane);
  auto* form = new QFormLayout;
  right->addLayout(form);
  auto* title = new QLineEdit;
  title->setObjectName("evidenceTitle");
  auto* topic = new QLineEdit;
  topic->setObjectName("evidenceTopic");
  auto* url = new QLineEdit;
  url->setObjectName("evidenceSource");
  auto* verified = new QComboBox;
  verified->setObjectName("evidenceVerification");
  verified->addItem("待核验", "unverified");
  verified->addItem("人工已核验", "manuallyVerified");
  form->addRow("标题", title);
  form->addRow("主题 / 产业", topic);
  form->addRow("原始来源链接", url);
  form->addRow("核验状态", verified);
  auto* body = new QPlainTextEdit;
  body->setObjectName("evidenceText");
  body->setPlaceholderText("原文、页码/时间点及核验笔记");
  right->addWidget(body, 1);
  auto chosen = std::make_shared<QString>();
  auto original = std::make_shared<QJsonObject>();
  auto fields = [=] {
    return QJsonObject{{"title", title->text()}, {"topic", topic->text()},
                      {"sourceUrl", url->text()}, {"text", body->toPlainText()},
                      {"verification", verified->currentData().toString()}};
  };
  auto baseline = std::make_shared<QJsonObject>(fields());
  auto load = [=](const QJsonObject& d) {
    *chosen = d["id"].toString(); *original = d;
    title->setText(d["title"].toString()); topic->setText(d["topic"].toString());
    url->setText(d["sourceUrl"].toString()); body->setPlainText(d["text"].toString());
    verified->setCurrentIndex(std::max(0, verified->findData(d["verification"].toString())));
    *baseline = fields();
  };
  page->openRecord = [=](const QJsonObject& expected) {
    business::require(fields() == *baseline, "研究资料有未保存修改，请先保存或明确放弃；未切换资料");
    const auto current=BusinessStore::readRecord(store->filePath(),"docs",expected["id"].toString());
    business::require(!expected["id"].toString().isEmpty() && !current.isEmpty() && current == expected,
                      "研究资料已变化或缺失，请重新读取本轮记录；没有打开其他版本");
    load(current);
    state->setText("已定位本轮研究原文 · " + current["id"].toString());
  };
  auto documents=std::make_shared<QJsonArray>();
  auto offset=std::make_shared<int>(0);
  auto* batch=new QHBoxLayout;l->addLayout(batch);
  auto* previousBatch=new QPushButton("上一页");previousBatch->setObjectName("evidencePrevious");batch->addWidget(previousBatch);
  auto* batchState=new QLabel;batchState->setObjectName("evidenceBatchState");batch->addWidget(batchState,1);
  auto* nextBatch=new QPushButton("下一页");nextBatch->setObjectName("evidenceNext");batch->addWidget(nextBatch);
  auto render = [=] {
    QSignalBlocker block(list);
    list->clear();
    *offset=qBound(0,*offset,qMax(0,((int(documents->size())-1)/100)*100));
    for (int n=*offset;n<qMin(*offset+100,int(documents->size()));++n) {
      const auto d = documents->at(n).toObject();
      auto* item = new QListWidgetItem(
          d["title"].toString() + "\n" + d["topic"].toString(), list);
      item->setData(Qt::UserRole, d);
      if(d["id"]==*chosen)list->setCurrentItem(item);
    }
    previousBatch->setEnabled(*offset>0);nextBatch->setEnabled(*offset+100<documents->size());
    batchState->setText(QString("匹配 %1 条 · 第%2/%3页 · 完整原文按ID读取").arg(documents->size()).arg(*offset/100+1).arg(qMax(1,(int(documents->size())+99)/100)));
  };
  QObject::connect(previousBatch,&QPushButton::clicked,page,[=]{*offset=qMax(0,*offset-100);render();});
  QObject::connect(nextBatch,&QPushButton::clicked,page,[=]{if(*offset+100<documents->size())*offset+=100;render();});
  auto* reads=new BusinessReadRequest(store->filePath(),page);
  QObject::connect(
      list, &QListWidget::itemClicked, page, [=](QListWidgetItem* item) {
        try {business::require(fields()==*baseline,"研究资料有未保存修改，请先保存或明确放弃；未切换资料");auto summary=item->data(Qt::UserRole).toJsonObject();reads->record("docs",summary["id"].toString(),summary["_recordSha256"].toString());state->setText("正在后台读取所选完整原文…");}
        catch (const std::exception& e) { state->setText(QString::fromUtf8(e.what())); }
      });
  QObject::connect(fresh, &QPushButton::clicked, page, [=] {
    if (fields() != *baseline) { state->setText("研究资料有未保存修改，请先保存或明确放弃"); return; }
    load({});
  });
  QObject::connect(discard, &QPushButton::clicked, page, [=] {
    load(*original); state->setText("已明确放弃未保存修改，恢复载入时内容；没有写入资料库");
  });
  QObject::connect(save, &QPushButton::clicked, page, [=] {
    try {
      QJsonObject update{{"id", *chosen},
                         {"title", title->text()},
                         {"topic", topic->text()},
                         {"sourceUrl", url->text()},
                         {"verification", verified->currentData().toString()},
                         {"text", body->toPlainText()}};
      auto item = chosen->isEmpty() ? QJsonObject() : *original;
      if (!chosen->isEmpty()) {
        const auto current=BusinessStore::readRecord(store->filePath(),"docs",*chosen);
        business::require(!current.isEmpty() && current == *original,
                          "资料已被其他操作修改或移除；当前草稿保留，没有覆盖原文");
      }
      for (auto it = update.begin(); it != update.end(); ++it)
        item[it.key()] = it.value();
      auto d = store->save("docs", item);
      *original = d;
      *chosen = d["id"].toString();
      *baseline = fields();
      state->setText("已保存 · " + d["updatedAt"].toString());
      if(page->refresh)page->refresh();
    } catch (const std::exception& e) {
      state->setText("未保存：" + QString::fromUtf8(e.what()));
    }
  });
  QObject::connect(imports, &QPushButton::clicked, page, [=] {
    if (fields() != *baseline) { state->setText("研究资料有未保存修改，请先保存或明确放弃"); return; }
    auto path = QFileDialog::getOpenFileName(page, "导入已有资料", {},
                                             "文字资料 (*.txt *.md)");
    if (path.isEmpty()) return;
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly) || f.size() > 2 * 1024 * 1024) {
      state->setText("文件不可读或超过2MB");
      return;
    }
    load({});
    title->setText(QFileInfo(path).completeBaseName());
    body->setPlainText(QString::fromUtf8(f.readAll()));
    url->clear();
    verified->setCurrentIndex(0);
    state->setText("已载入编辑区，填写来源后保存");
  });
  page->refresh = [=] {reads->list("docs",search->text());};
  reads->completed=[=](QJsonObject result){
    if(!result["error"].toString().isEmpty()){state->setText(result["error"].toString()+"；已载结果和草稿保留");return;}
    if(result["operation"]=="list"){
      if(result["query"]!=search->text())return;
      *documents=result["rows"].toArray();page->setProperty("listReady",true);render();
    }else{
      if(fields()!=*baseline){state->setText("载入期间产生未保存修改；当前草稿保留，未切换资料");return;}
      const auto row=result["row"].toObject();if(row.isEmpty()){state->setText("所选原文已删除；当前草稿保留");return;}
      load(row);state->setText("已读取完整原文 · "+row["id"].toString());
    }
  };
  auto* queryDelay=new QTimer(page);queryDelay->setSingleShot(true);queryDelay->setInterval(150);
  QObject::connect(search,&QLineEdit::textChanged,page,[=]{*offset=0;queryDelay->start();});
  QObject::connect(queryDelay,&QTimer::timeout,page,[=]{page->refresh();});
  QObject::connect(reload,&QPushButton::clicked,page,[=]{page->refresh();});
  split->setSizes({280, 1000});
  render();
  return page;
}
void openResearchDocument(QWidget* workspace, const QJsonObject& expected) {
  auto* evidence = dynamic_cast<BusinessWidget*>(workspace->findChild<QWidget*>("researchPage"));
  business::require(evidence && bool(evidence->openRecord), "研究原文编辑页未就绪");
  evidence->openRecord(expected);
  if (auto* tabs = qobject_cast<QTabWidget*>(workspace)) tabs->setCurrentWidget(evidence);
}
QWidget* researchPage(std::shared_ptr<BusinessStore> store,QWidget* parent) {
  auto tabs=new QTabWidget(parent);tabs->setObjectName("researchWorkspace");
  tabs->addTab(evidencePage(store,tabs),"原文 / 证据库");
  auto industryHost=new QWidget(tabs);auto layout=new QVBoxLayout(industryHost);layout->setContentsMargins(0,0,0,0);
  tabs->addTab(industryHost,"产业主题 / 证据关系");
  QObject::connect(tabs,&QTabWidget::currentChanged,industryHost,[store,industryHost,layout](int index){
    if(index!=1||industryHost->property("loaded").toBool())return;
    while(auto item=layout->takeAt(0)){delete item->widget();delete item;}
    try{layout->addWidget(industryPage(store,industryHost));industryHost->setProperty("loaded",true);}
    catch(const std::exception&e){auto error=new QLabel(QString::fromUtf8(e.what()),industryHost);error->setWordWrap(true);layout->addWidget(error);}
  });
  auto creatorHost=new QWidget(tabs);auto creatorLayout=new QVBoxLayout(creatorHost);creatorLayout->setContentsMargins(0,0,0,0);tabs->addTab(creatorHost,"作者观点 / 关系图");
  QObject::connect(tabs,&QTabWidget::currentChanged,creatorHost,[store,creatorHost,creatorLayout](int index){if(index!=2||creatorHost->property("loaded").toBool())return;try{creatorLayout->addWidget(creatorPage(store,creatorHost));creatorHost->setProperty("loaded",true);}catch(const std::exception&e){auto error=new QLabel(QString::fromUtf8(e.what()),creatorHost);error->setWordWrap(true);creatorLayout->addWidget(error);}});
  return tabs;
}
QWidget* businessSettingsPage(std::shared_ptr<BusinessStore> store,
                              QWidget* parent) {
  auto* page = new RestorePreviewWidget(parent);
  page->setObjectName("businessSettingsPage");
  auto* l = new QVBoxLayout(page);
  auto* state = new QLabel(
      "备份账户、流水、资料与报告；行情历史独立保存。");
  state->setWordWrap(true);
  l->addWidget(state);
  auto* tools = new QHBoxLayout;
  l->addLayout(tools);
  auto* exports = button(tools, "导出业务备份", "exportBusiness");
  auto* imports = button(tools, "选择备份并预览", "previewBusiness");
  auto* legacy = button(tools, "读取旧数据库（只读）", "previewLegacyDatabase");
  auto* exportPending = button(tools, "导出迁移包给安卓", "exportLegacyBundle");
  exportPending->setEnabled(false);
  auto* apply = button(tools, "合并预览记录", "applyBusiness");
  apply->setEnabled(false);
  auto* preview = new QPlainTextEdit;
  preview->setObjectName("businessRestorePreview");
  preview->setReadOnly(true);
  l->addWidget(preview, 1);
  auto pending = std::make_shared<QJsonObject>();
  auto stage = [=](const QJsonObject& input) {
    page->guard = {};
    *pending = input;
    QString text = "本次预览（最多列出每类前30条；原文完整保存在迁移包）\n";
    for (const auto& kind : business::kinds()) {
      QSet<QString> existing;
      for (auto v : store->read(kind))
        existing.insert(v.toObject()["id"].toString());
      auto rows = input[kind].toArray();
      int duplicates = 0;
      for (auto v : rows)
        if (existing.contains(v.toObject()["id"].toString())) ++duplicates;
      text += QString("\n%1：%2条，与本机同ID %3条\n")
                  .arg(kind)
                  .arg(rows.size())
                  .arg(duplicates);
      for (int i = 0; i < std::min(30, int(rows.size())); ++i) {
        auto r = rows[i].toObject();
        text += r["id"].toString() + "  " +
                r["title"].toString(r["name"].toString()) + "\n";
      }
    }
    text +=
        "\n本次未迁表：" +
        QString::fromUtf8(QJsonDocument(input["notMigratedTables"].toArray())
                              .toJson(QJsonDocument::Compact));
    preview->setPlainText(text);
    state->setText(
        input["mergePolicy"] == "keep-existing"
            ? "旧库只读迁移：同ID跳过，保留原生编辑。仅用于同一旧库，非多库合并"
              "；已删除记录再次导入会恢复。当前只迁账本、资料及账本快照，不启用"
              "旧采集配置。"
            : "备份恢复：同ID更新，其他记录保留。应用前保存当前业务快照。");
    apply->setEnabled(true);
    exportPending->setEnabled(true);
  };
  page->stage = stage;
  QObject::connect(legacy, &QPushButton::clicked, page, [=] {
    auto path = QFileDialog::getOpenFileName(page, "只读旧程序数据库", {},
                                             "SQLite (*.db *.sqlite)");
    if (path.isEmpty()) return;
    apply->setEnabled(false);
    legacy->setEnabled(false);
    exportPending->setEnabled(false);
    state->setText("正在只读提取旧业务，请稍候…");
    auto result = std::make_shared<QJsonObject>();
    auto error = std::make_shared<QString>();
    auto* worker = QThread::create([=] {
      try {
        *result = legacydata::readBusiness(path);
      } catch (const std::exception& e) {
        *error = QString::fromUtf8(e.what());
      }
    });
    QObject::connect(worker, &QThread::finished, page, [=] {
      legacy->setEnabled(true);
      if (!error->isEmpty()) {
        state->setText("读取未完成：" + *error);
        return;
      }
      try {
        stage(*result);
      } catch (const std::exception& e) {
        state->setText(QString::fromUtf8(e.what()));
      }
    });
    QObject::connect(worker, &QThread::finished, worker, &QObject::deleteLater);
    worker->start();
  });
  QObject::connect(exportPending, &QPushButton::clicked, page, [=] {
    auto path =
        QFileDialog::getSaveFileName(page, "保存预览迁移包（含私人资料）",
                                     "旧业务迁移包.json", "JSON (*.json)");
    if (path.isEmpty()) return;
    QSaveFile file(path);
    auto bytes = QJsonDocument(*pending).toJson(QJsonDocument::Compact);
    if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() ||
        !file.commit())
      state->setText("迁移包未保存");
    else
      state->setText("迁移包已保存。可在安卓“我的→选择备份并预览”独立导入。");
  });
  QObject::connect(exports, &QPushButton::clicked, page, [=] {
    auto path = QFileDialog::getSaveFileName(
        page, "保存业务备份", "原生业务备份.json", "JSON (*.json)");
    if (path.isEmpty()) return;
    try {
      QSaveFile file(path);
      auto data = QJsonDocument(store->backup()).toJson(QJsonDocument::Compact);
      business::require(file.open(QIODevice::WriteOnly) &&
                            file.write(data) == data.size() && file.commit(),
                        "备份未保存");
      state->setText("业务备份已保存");
    } catch (const std::exception& e) {
      state->setText(QString::fromUtf8(e.what()));
    }
  });
  QObject::connect(imports, &QPushButton::clicked, page, [=] {
    apply->setEnabled(false);
    *pending = QJsonObject();
    auto path =
        QFileDialog::getOpenFileName(page, "预览业务备份", {}, "JSON (*.json)");
    if (path.isEmpty()) return;
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly) || f.size() > business::backupByteLimit) {
      state->setText("文件不可读或超过32MiB");
      return;
    }
    QJsonParseError error;
    auto d = QJsonDocument::fromJson(f.readAll(), &error);
    if (error.error != QJsonParseError::NoError ||
        d.object()["schema"] != "native-business-v1") {
      state->setText("备份格式无效");
      return;
    }
    stage(d.object());
  });
  QObject::connect(apply, &QPushButton::clicked, page, [=] {
    try { if(page->guard) page->guard(); }
    catch(const std::exception& e){ state->setText(QString::fromUtf8(e.what()));return; }
    if (QMessageBox::question(
            page, "合并备份",
            (*pending)["mergePolicy"] == "keep-existing"
                ? "确认迁入？同ID旧记录跳过，保留本机编辑。"
                : "确认合并预览中的记录？同ID会替换，所有流水将重新校验。") !=
        QMessageBox::Yes)
      return;
    try {
      auto before = store->backup();
      auto path = QFileDialog::getSaveFileName(
          page, "先保存恢复前快照", "恢复前备份.json", "JSON (*.json)");
      if (path.isEmpty()) return;
      if(page->guard) page->guard(); // File chooser may have run other local updates.
      QSaveFile out(path);
      auto data = QJsonDocument(before).toJson(QJsonDocument::Compact);
      business::require(out.open(QIODevice::WriteOnly) &&
                            out.write(data) == data.size() && out.commit(),
                        "恢复前快照未保存");
      if(page->guard) page->guard();
      store->restore(*pending);
      state->setText("已事务合并；业务页点击重算或重新打开读取");
      apply->setEnabled(false);
    } catch (const std::exception& e) {
      state->setText("合并未完成，原记录保留：" + QString::fromUtf8(e.what()));
    }
  });
  return page;
}
void previewBusinessRestore(QWidget* widget,const QJsonObject& incoming,std::function<void()> guard){
  auto* page=dynamic_cast<RestorePreviewWidget*>(widget);
  business::require(page && bool(page->stage),"原生备份预览入口不可用");
  business::require(incoming.value("schema")=="native-business-v1","不支持的备份格式");
  if(guard)guard();
  page->stage(incoming);
  page->guard=std::move(guard);
}
