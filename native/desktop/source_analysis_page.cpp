#include "source_analysis_page.hpp"
#include "source_handoff_page.hpp"
#include "source_analysis_packet.hpp"
#include "source_handoff_store.hpp"
#include "native_read_pool.hpp"
#include <QtWidgets>
#include <QtSql>
#include <QSaveFile>
#include <atomic>
namespace {
QJsonObject readAuthorDirectory(const QString& path, const std::shared_ptr<std::atomic_bool>& stopped) {
  auto active = [&]{business::require(!stopped->load(), "作者目录读取已取消");}; active();
  business::require(QFileInfo(path).isFile(), "资料库不存在，未创建");
  const auto name = QUuid::createUuid().toString(); auto db = QSqlDatabase::addDatabase("QSQLITE", name);
  auto close = [&]{db.close();db={};QSqlDatabase::removeDatabase(name);};
  try {
    db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");
    business::require(db.open(), "资料库只读连接失败");business::require(db.transaction(), "作者目录只读快照失败");
    QJsonArray rows;
    {
      QStringList fields{"id","author","channelName","channel","sourceProfile","legacySource"}, members;
      for (auto field : fields) members << "'"+field+"',json_extract(payload,'$."+field+"')";
      members << "'legacyOriginal',json_object('channel_id',json_extract(payload,'$.legacyOriginal.channel_id'),'author',json_extract(payload,'$.legacyOriginal.author'))";
      const QString valid = "CASE WHEN json_valid(payload) THEN json_type(payload)='object' ELSE 0 END";
      QSqlQuery query(db);
      business::require(query.exec("SELECT id,length(CAST(payload AS BLOB)),CASE WHEN "+valid+" THEN json_object("+members.join(',')+") ELSE NULL END FROM records WHERE kind='collections' ORDER BY rowid"), "作者目录暂不可读，请重试");
      while (query.next()) {
        active();business::require(query.value(1).toLongLong()>0&&query.value(1).toLongLong()<=business::backupByteLimit,"作者目录原记录损坏或超过32MiB");
        QJsonParseError error;const auto document=QJsonDocument::fromJson(query.value(2).toString().toUtf8(),&error);
        business::require(error.error==QJsonParseError::NoError&&document.isObject()&&!query.value(0).toString().isEmpty()&&document.object()["id"]==query.value(0).toString(),"作者目录原记录身份或内容损坏");
        rows.append(document.object());
      }
      business::require(!query.lastError().isValid(),"作者目录读取中断，请重试");
    }
    auto result=sourceAnalysis::authorDirectory(rows);active();
    business::require(db.commit(),"作者目录只读事务结束失败");close();return result;
  } catch (...) {db.rollback();close();throw;}
}
class AuthorDirectoryRead final : public QObject {
  QPointer<QWidget> page;QString path;quint64 generation=0;bool running=false,pending=false;
  std::shared_ptr<std::atomic_bool> stopped=std::make_shared<std::atomic_bool>(false);
  void start() {
    if(running||!pending||!page||!page->isVisible())return;
    pending=false;running=true;const auto token=generation;auto flag=std::make_shared<std::atomic_bool>(false);stopped=flag;
    QPointer<AuthorDirectoryRead> self(this);QPointer<QObject> app(QCoreApplication::instance());const auto file=path;
    nativeReadPool()->start([self,app,file,token,flag]{
      QJsonObject result;QString error;try{result=readAuthorDirectory(file,flag);}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
      if(app)QMetaObject::invokeMethod(app,[self,token,result,error]{
        if(!self)return;self->running=false;
        if(self->pending){self->start();return;}
        if(token!=self->generation||!self->page||!self->page->isVisible())return;
        if(self->completed)self->completed(result,error);
      },Qt::QueuedConnection);
    });
  }
  bool eventFilter(QObject* object,QEvent* event) override {
    if(object==page){if(event->type()==QEvent::Hide)cancel();else if(event->type()==QEvent::Show)refresh();}
    return QObject::eventFilter(object,event);
  }
 public:
  std::function<void()> requested;
  std::function<void(QJsonObject,QString)> completed;
  AuthorDirectoryRead(QString file,QWidget* owner):QObject(owner),page(owner),path(std::move(file)){owner->installEventFilter(this);}
  ~AuthorDirectoryRead()override{cancel();}
  void cancel(){++generation;stopped->store(true);pending=false;}
  void refresh(){if(!page||!page->isVisible())return;++generation;stopped->store(true);pending=true;if(requested)requested();start();}
};
}
QWidget* sourceAnalysisPage(std::shared_ptr<BusinessStore> business,QWidget* parent,SourceHandoffOpener opener) {
  auto page=new QWidget(parent);page->setObjectName("sourceAnalysisPage");auto root=new QVBoxLayout(page);auto tabs=new QTabWidget;root->addWidget(tabs);
  auto analysis=new QWidget;tabs->addTab(analysis,"整理材料 / 手动回填");tabs->addTab(sourceHandoffPage(business,tabs,opener),"交接历史");auto form=new QVBoxLayout(analysis);
  auto state=new QLabel("材料编排与手动回填 · 未授权外发");state->setObjectName("sourceAnalysisState");state->setWordWrap(true);form->addWidget(state);
  auto store=std::make_shared<SourceHandoffStore>(business->filePath()+".source-handoff.sqlite");
  auto subject=new QComboBox;subject->setObjectName("sourceAnalysisSubject");subject->addItem("全部已保存作者","");
  auto purpose=new QComboBox;purpose->setObjectName("sourceAnalysisPurpose");for(auto p:QList<QPair<QString,QString>>{{"核心观点与证据","overview"},{"观点时间线","timeline"},{"行业股票线索","sectors"},{"风险矛盾核查","risks"}})purpose->addItem(p.first,p.second);
  auto mode=new QComboBox;mode->setObjectName("sourceAnalysisMode");mode->addItem("最近","recent");mode->addItem("日期范围（北京）","date");mode->addItem("全部","all");auto limit=new QSpinBox;limit->setRange(1,1000);limit->setValue(10);
  auto from=new QLineEdit,to=new QLineEdit;from->setObjectName("sourceAnalysisFrom");to->setObjectName("sourceAnalysisTo");from->setPlaceholderText("开始 YYYY-MM-DD");to->setPlaceholderText("结束 YYYY-MM-DD");
  auto grid=new QFormLayout;form->addLayout(grid);grid->addRow("作者范围",subject);grid->addRow("分析目的",purpose);grid->addRow("材料范围",mode);grid->addRow("最近条数",limit);grid->addRow("开始",from);grid->addRow("结束",to);
  auto title=new QLineEdit;title->setObjectName("sourceAnalysisTitle");title->setPlaceholderText("交接记录标题");form->addWidget(title);
  auto actions=new QHBoxLayout;form->addLayout(actions);auto generate=new QPushButton("生成完整材料"),copy=new QPushButton("复制材料全文"),exportPacket=new QPushButton("导出材料 Markdown"),fresh=new QPushButton("新建分析（清当前草稿）"),refreshAuthors=new QPushButton("刷新作者目录");for(auto b:{generate,copy,exportPacket,fresh,refreshAuthors})actions->addWidget(b);
  refreshAuthors->setObjectName("sourceAnalysisRefreshAuthors");
  auto preview=new QPlainTextEdit;preview->setReadOnly(true);preview->setObjectName("sourceAnalysisPreview");form->addWidget(preview,1);
  auto answer=new QPlainTextEdit;answer->setObjectName("sourceAnalysisAnswer");answer->setPlaceholderText("手动粘贴外部回答；提取只预览，保存明确写入本机历史，不回写股票/组合。");form->addWidget(answer,1);
  auto extracted=new QPlainTextEdit;extracted->setReadOnly(true);extracted->setMaximumHeight(140);extracted->setObjectName("sourceAnalysisExtracted");form->addWidget(extracted);
  auto parse=new QPushButton("预览结果块"),save=new QPushButton("保存交接记录"),reloadDraft=new QPushButton("重读共享草稿（取最新）");form->addWidget(parse);form->addWidget(save);form->addWidget(reloadDraft);
  struct Draft{QJsonObject packet;QString last,revision,subjectText;QJsonValue subjectKey;bool hasSubjectKey=false,loading=true;};auto draft=std::make_shared<Draft>();
  auto directory=std::make_shared<QJsonObject>();
  auto renderAuthors=[=]{
    QSignalBlocker block(subject);subject->clear();subject->addItem("全部已保存作者",QString());
    for(auto value:(*directory)["authors"].toArray()){const auto entry=value.toObject();subject->addItem(entry["label"].toString(),entry["key"].toString());}
    QString key;bool resolved=true;
    if(draft->hasSubjectKey){resolved=draft->subjectKey.isString();if(resolved){const auto savedKey=draft->subjectKey.toString();key=(*directory)["aliases"].toObject()[savedKey].toString(savedKey);resolved=key.isEmpty()||subject->findData(key)>=0;}}
    else if(!draft->subjectText.isEmpty()){
      QSet<QString> matches;for(auto value:(*directory)["authors"].toArray()){const auto entry=value.toObject();if(entry["subjects"].toArray().contains(draft->subjectText))matches.insert(entry["key"].toString());}
      resolved=matches.size()==1;if(resolved)key=*matches.cbegin();
    }
    if(resolved)subject->setCurrentIndex(qMax(0,subject->findData(key)));
    else{subject->addItem("作者范围待确认："+(draft->subjectText.isEmpty()?draft->subjectKey.toString("无效作者身份"):draft->subjectText),QVariant());subject->setCurrentIndex(subject->count()-1);}
  };
  auto safe=[state](auto work){try{work();}catch(const std::exception& e){state->setText(QString::fromUtf8(e.what()));}};
  auto persist=[=]{if(!draft->loading){QJsonObject value{{"packet",draft->packet},{"answer",answer->toPlainText()},{"title",title->text()},{"lastSaved",draft->last},{"subject",draft->subjectText},{"purpose",purpose->currentData().toString()},{"mode",mode->currentData().toString()},{"limit",limit->value()},{"from",from->text()},{"to",to->text()}};if(draft->hasSubjectKey)value["subjectKey"]=draft->subjectKey;draft->revision=store->saveDraft(value,draft->revision)["draftRevision"].toString();}};
  auto restore=[=]{const auto saved=store->draft();draft->loading=true;draft->packet=saved["packet"].toObject();draft->last=saved["lastSaved"].toString();draft->revision=saved["draftRevision"].toString();draft->subjectText=saved["subject"].toString();draft->hasSubjectKey=saved.contains("subjectKey");draft->subjectKey=saved.value("subjectKey");title->setText(saved["title"].toString());answer->setPlainText(saved["answer"].toString());renderAuthors();for(auto p:QList<QPair<QComboBox*,QString>>{{purpose,"purpose"},{mode,"mode"}}){int i=p.first->findData(saved[p.second].toString());if(i>=0)p.first->setCurrentIndex(i);}limit->setValue(saved["limit"].toInt(10));from->setText(saved["from"].toString());to->setText(saved["to"].toString());preview->setPlainText(draft->packet["markdown"].toString());draft->loading=false;};safe(restore);
  auto reads=new AuthorDirectoryRead(business->filePath(),page);
  reads->requested=[=]{state->setText("正在读取作者目录；冻结材料和草稿保留…");};
  reads->completed=[=](QJsonObject result,QString error){if(!error.isEmpty()){state->setText("作者目录读取失败；原目录和草稿保留："+error);return;}*directory=result;renderAuthors();state->setText(subject->currentData().isValid()?"作者目录已更新；冻结材料和草稿保留":"作者目录已更新；旧作者范围待确认，请重新选择作者");};
  QObject::connect(refreshAuthors,&QPushButton::clicked,page,[=]{reads->refresh();});
  QObject::connect(reloadDraft,&QPushButton::clicked,page,[=]{safe([=]{restore();state->setText("已明确取最新共享草稿；其他入口新稿未被覆盖");});});
  QObject::connect(answer,&QPlainTextEdit::textChanged,page,[=]{safe(persist);});QObject::connect(title,&QLineEdit::textChanged,page,[=]{safe(persist);});
  QObject::connect(subject,&QComboBox::currentIndexChanged,page,[=]{if(draft->loading||!subject->currentData().isValid())return;draft->hasSubjectKey=true;draft->subjectKey=subject->currentData().toString();draft->subjectText.clear();for(auto value:(*directory)["authors"].toArray()){const auto entry=value.toObject();if(entry["key"]==draft->subjectKey){draft->subjectText=entry["subject"].toString();break;}}safe(persist);});
  for(auto c:{purpose,mode})QObject::connect(c,&QComboBox::currentIndexChanged,page,[=]{safe(persist);});for(auto e:{from,to})QObject::connect(e,&QLineEdit::textChanged,page,[=]{safe(persist);});QObject::connect(limit,&QSpinBox::valueChanged,page,[=]{safe(persist);});
  QObject::connect(generate,&QPushButton::clicked,page,[=]{safe([=]{business::require(answer->toPlainText().trimmed().isEmpty(),"已有回填草稿；请先保存或明确新建分析，再换材料");business::require(subject->currentData().isValid(),"旧作者范围已缺失或存在同名歧义；请重新选择作者");const auto packet=sourceAnalysis::build(draft->subjectText,business->read("collections"),{{"subjectKey",subject->currentData().toString()},{"mode",mode->currentData().toString()},{"purpose",purpose->currentData().toString()},{"limit",limit->value()},{"from",from->text()},{"to",to->text()}});draft->packet=packet;draft->last.clear();preview->setPlainText(packet["markdown"].toString());persist();state->setText(QString("已冻结%1条完整来源材料；日期/目的变更后须重新生成。%2").arg(packet["itemCount"].toInt()).arg(packet["warnings"].toArray()[0].toString()));});});
  QObject::connect(copy,&QPushButton::clicked,page,[=]{safe([=]{business::require(!draft->packet.isEmpty(),"请先生成材料");QApplication::clipboard()->setText(draft->packet["markdown"].toString());state->setText("完整材料已复制；未上传、未调用AI");});});
  QObject::connect(exportPacket,&QPushButton::clicked,page,[=]{safe([=]{business::require(!draft->packet.isEmpty(),"请先生成材料");const auto path=QFileDialog::getSaveFileName(page,"导出完整本机材料","分析材料.md");if(path.isEmpty())return;const auto bytes=draft->packet["markdown"].toString().toUtf8();QSaveFile file(path);business::require(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"材料导出失败");state->setText("完整材料已导出："+path);});});
  QObject::connect(parse,&QPushButton::clicked,page,[=]{safe([=]{extracted->setPlainText(sourceAnalysis::extractResult(answer->toPlainText())["text"].toString());state->setText("只预览提取结果；原回答保留，尚未保存历史");});});
  QObject::connect(save,&QPushButton::clicked,page,[=]{safe([=]{business::require(store->draft()["draftRevision"].toString()==draft->revision,"其他入口已更新共享草稿；请重读后明确保存");const auto signature=sourceAnalysis::hash(draft->packet["markdown"].toString()+QChar(0)+title->text()+QChar(0)+answer->toPlainText());business::require(signature!=draft->last,"相同材料和回答已保存；历史未重复写入");const auto record=store->saveResult(draft->packet,title->text(),answer->toPlainText());draft->last=signature;persist();state->setText("已保存本机交接记录（手动回填，待核验）："+record["id"].toString());});});
  QObject::connect(fresh,&QPushButton::clicked,page,[=]{safe([=]{draft->loading=true;draft->packet={};draft->last.clear();answer->clear();title->clear();preview->clear();extracted->clear();draft->loading=false;persist();state->setText("已明确新建分析；已保存历史保留");});});
  return page;
}
