#include "source_handoff_page.hpp"
#include "source_handoff_store.hpp"
#include "source_analysis_packet.hpp"
#include <QtWidgets>
#include <QSaveFile>

QWidget* sourceHandoffPage(std::shared_ptr<BusinessStore> business, QWidget* parent, SourceHandoffOpener opener) {
  auto page=new QWidget(parent); page->setObjectName("sourceHandoffPage"); auto root=new QVBoxLayout(page);
  auto state=new QLabel("交接历史 · 手动回填待核验"); state->setWordWrap(true); state->setObjectName("sourceHandoffState"); root->addWidget(state);
  auto store=std::make_shared<SourceHandoffStore>(business->filePath()+".source-handoff.sqlite");
  auto bar=new QHBoxLayout; root->addLayout(bar); auto kind=new QLineEdit; kind->setPlaceholderText("类型筛选，空为全部（source-analysis / stock / general…）"); kind->setObjectName("sourceHandoffKind"); bar->addWidget(kind,1);
  auto refresh=new QPushButton("重读历史"), previous=new QPushButton("上一页"), next=new QPushButton("下一页"), import=new QPushButton("预览旧JSON / 备份"), exportAll=new QPushButton("导出全部交接备份");
  for(auto b:{refresh,previous,next,import,exportAll})bar->addWidget(b);
  auto split=new QSplitter;root->addWidget(split,1);auto list=new QListWidget;list->setObjectName("sourceHandoffList");split->addWidget(list);
  auto right=new QWidget;split->addWidget(right);auto form=new QVBoxLayout(right);auto tabs=new QTabWidget;form->addWidget(tabs,1);
  auto prompt=new QPlainTextEdit, result=new QPlainTextEdit, raw=new QPlainTextEdit, context=new QPlainTextEdit;
  int n=0;for(auto t:{prompt,result,raw,context}){t->setReadOnly(true);tabs->addTab(t,QStringList{"原提示词全文","结果全文","原回答全文","来源快照 / 上下文"}[n++]);}
  result->setObjectName("sourceHandoffResult");context->setObjectName("sourceHandoffContext");
  auto sources=new QComboBox;sources->setObjectName("sourceHandoffSources");form->addWidget(sources);
  auto actions=new QHBoxLayout;form->addLayout(actions);auto copy=new QPushButton("复制结果全文"),locate=new QPushButton("打开对应原版本"),exportOne=new QPushButton("导出当前记录JSON");for(auto b:{copy,locate,exportOne})actions->addWidget(b);
  auto preview=new QPlainTextEdit;preview->setReadOnly(true);preview->setObjectName("sourceHandoffImportPreview");root->addWidget(preview);preview->hide();
  auto confirm=new QPushButton("确认合并（保留已有，冲突不覆盖）"),cancel=new QPushButton("取消导入");root->addWidget(confirm);root->addWidget(cancel);confirm->hide();cancel->hide();
  struct View {int offset=0;QJsonObject selected,pending;};auto view=std::make_shared<View>();
  auto safe=[state](auto work){try{work();}catch(const std::exception& e){state->setText(QString::fromUtf8(e.what()));}};
  auto load=[=]{list->clear();view->selected={};prompt->clear();result->clear();raw->clear();context->clear();sources->clear();const auto rows=store->page(view->offset,kind->text().trimmed());for(auto v:rows){const auto r=v.toObject();auto item=new QListWidgetItem(r["title"].toString()+" · "+r["kind"].toString()+" · "+r["savedAt"].toString(),list);item->setData(Qt::UserRole,r["id"]);}previous->setEnabled(view->offset>0);next->setEnabled(rows.size()==50);state->setText(QString("交接记录 %1–%2 · 手动回填待核验").arg(rows.isEmpty()?0:view->offset+1).arg(view->offset+rows.size()));};
  auto saveFile=[page,state](const QByteArray& bytes,const QString& suggested){const auto path=QFileDialog::getSaveFileName(page,"明确导出本机文件",suggested);if(path.isEmpty())return;QSaveFile f(path);business::require(f.open(QIODevice::WriteOnly)&&f.write(bytes)==bytes.size()&&f.commit(),"导出失败，未报告成功");state->setText("已导出："+path);};
  QObject::connect(refresh,&QPushButton::clicked,page,[=]{safe([=]{view->offset=0;load();});});
  QObject::connect(previous,&QPushButton::clicked,page,[=]{safe([=]{view->offset=qMax(0,view->offset-50);load();});});
  QObject::connect(next,&QPushButton::clicked,page,[=]{safe([=]{view->offset+=50;load();});});
  QObject::connect(list,&QListWidget::currentItemChanged,page,[=](QListWidgetItem* item){if(!item)return;safe([=]{view->selected=store->detail(item->data(Qt::UserRole).toString());const auto r=view->selected;prompt->setPlainText(r["prompt"].toString());result->setPlainText(r["result"].toString());raw->setPlainText(r["rawResult"].toString(r["result"].toString()));context->setPlainText(QString::fromUtf8(QJsonDocument(r).toJson()));sources->clear();for(auto v:r["sourceReferences"].toArray()){const auto ref=v.toObject();sources->addItem(ref["snapshot"].toObject()["title"].toString()+" · "+ref["id"].toString(),ref);}});});
  QObject::connect(copy,&QPushButton::clicked,page,[=]{QApplication::clipboard()->setText(result->toPlainText());state->setText("已复制结果全文；未上传、未改写记录");});
  QObject::connect(locate,&QPushButton::clicked,page,[=]{safe([=]{business::require(sources->currentIndex()>=0,"旧记录未保存可定位来源；可看完整上下文");const auto ref=sources->currentData().toJsonObject();const auto current=sourceAnalysis::exactSource(ref,business->read(ref["kind"].toString()));business::require(bool(opener),"宿主来源入口待接线；已核对原版本，未跳转");opener(ref["kind"].toString(),current);});});
  QObject::connect(exportOne,&QPushButton::clicked,page,[=]{safe([=]{business::require(!view->selected.isEmpty(),"请先选择交接记录");saveFile(QJsonDocument(QJsonObject{{"schema","source-handoff-v1"},{"records",QJsonArray{store->detail(view->selected["id"].toString())}}}).toJson(),"交接记录.json");});});
  QObject::connect(exportAll,&QPushButton::clicked,page,[=]{safe([=]{saveFile(store->backup(),"交接历史备份.json");});});
  QObject::connect(import,&QPushButton::clicked,page,[=]{safe([=]{view->pending={};confirm->hide();cancel->hide();preview->hide();const auto path=QFileDialog::getOpenFileName(page,"选择用户导出的交接JSON",{},"JSON (*.json)");if(path.isEmpty())return;QFile f(path);business::require(f.size()<=sourceAnalysis::ByteLimit&&f.open(QIODevice::ReadOnly),"导入文件不可读或超过25MiB");view->pending=store->previewImport(f.readAll(),QFileInfo(path).fileName());preview->setPlainText(QString::fromUtf8(QJsonDocument(view->pending).toJson()));preview->show();confirm->show();cancel->show();confirm->setEnabled(view->pending["errors"].toArray().isEmpty());state->setText("只读预览；尚未写入历史。核对新增、重复、冲突和错误后明确合并。");});});
  QObject::connect(cancel,&QPushButton::clicked,page,[=]{view->pending={};preview->clear();preview->hide();confirm->hide();cancel->hide();state->setText("已取消预览，历史未改");});
  QObject::connect(confirm,&QPushButton::clicked,page,[=]{safe([=]{const auto report=store->merge(view->pending);view->pending={};preview->hide();confirm->hide();cancel->hide();view->offset=0;load();state->setText("合并完成（冲突保留已有）："+QString::fromUtf8(QJsonDocument(report).toJson(QJsonDocument::Compact)));});});
  safe(load);return page;
}
