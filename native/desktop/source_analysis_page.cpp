#include "source_analysis_page.hpp"
#include "source_handoff_page.hpp"
#include "source_analysis_packet.hpp"
#include "source_handoff_store.hpp"
#include <QtWidgets>
#include <QSaveFile>
QWidget* sourceAnalysisPage(std::shared_ptr<BusinessStore> business,QWidget* parent,SourceHandoffOpener opener) {
  auto page=new QWidget(parent);page->setObjectName("sourceAnalysisPage");auto root=new QVBoxLayout(page);auto tabs=new QTabWidget;root->addWidget(tabs);
  auto analysis=new QWidget;tabs->addTab(analysis,"整理材料 / 手动回填");tabs->addTab(sourceHandoffPage(business,tabs,opener),"交接历史");auto form=new QVBoxLayout(analysis);
  auto state=new QLabel("材料编排与手动回填 · 未授权外发");state->setObjectName("sourceAnalysisState");state->setWordWrap(true);form->addWidget(state);
  auto store=std::make_shared<SourceHandoffStore>(business->filePath()+".source-handoff.sqlite");
  auto subject=new QComboBox;subject->setObjectName("sourceAnalysisSubject");subject->addItem("全部已保存作者","");QSet<QString> seen;for(auto v:business->read("collections")){auto s=sourceAnalysis::subject(v.toObject());if(!seen.contains(s)){seen.insert(s);subject->addItem(s,s);}}
  auto purpose=new QComboBox;purpose->setObjectName("sourceAnalysisPurpose");for(auto p:QList<QPair<QString,QString>>{{"核心观点与证据","overview"},{"观点时间线","timeline"},{"行业股票线索","sectors"},{"风险矛盾核查","risks"}})purpose->addItem(p.first,p.second);
  auto mode=new QComboBox;mode->setObjectName("sourceAnalysisMode");mode->addItem("最近","recent");mode->addItem("日期范围（北京）","date");mode->addItem("全部","all");auto limit=new QSpinBox;limit->setRange(1,1000);limit->setValue(10);
  auto from=new QLineEdit,to=new QLineEdit;from->setObjectName("sourceAnalysisFrom");to->setObjectName("sourceAnalysisTo");from->setPlaceholderText("开始 YYYY-MM-DD");to->setPlaceholderText("结束 YYYY-MM-DD");
  auto grid=new QFormLayout;form->addLayout(grid);grid->addRow("作者范围",subject);grid->addRow("分析目的",purpose);grid->addRow("材料范围",mode);grid->addRow("最近条数",limit);grid->addRow("开始",from);grid->addRow("结束",to);
  auto title=new QLineEdit;title->setObjectName("sourceAnalysisTitle");title->setPlaceholderText("交接记录标题");form->addWidget(title);
  auto actions=new QHBoxLayout;form->addLayout(actions);auto generate=new QPushButton("生成完整材料"),copy=new QPushButton("复制材料全文"),exportPacket=new QPushButton("导出材料 Markdown"),fresh=new QPushButton("新建分析（清当前草稿）");for(auto b:{generate,copy,exportPacket,fresh})actions->addWidget(b);
  auto preview=new QPlainTextEdit;preview->setReadOnly(true);preview->setObjectName("sourceAnalysisPreview");form->addWidget(preview,1);
  auto answer=new QPlainTextEdit;answer->setObjectName("sourceAnalysisAnswer");answer->setPlaceholderText("手动粘贴外部回答；提取只预览，保存明确写入本机历史，不回写股票/组合。");form->addWidget(answer,1);
  auto extracted=new QPlainTextEdit;extracted->setReadOnly(true);extracted->setMaximumHeight(140);extracted->setObjectName("sourceAnalysisExtracted");form->addWidget(extracted);
  auto parse=new QPushButton("预览结果块"),save=new QPushButton("保存交接记录"),reloadDraft=new QPushButton("重读共享草稿（取最新）");form->addWidget(parse);form->addWidget(save);form->addWidget(reloadDraft);
  struct Draft{QJsonObject packet;QString last,revision;bool loading=true;};auto draft=std::make_shared<Draft>();
  auto safe=[state](auto work){try{work();}catch(const std::exception& e){state->setText(QString::fromUtf8(e.what()));}};
  auto persist=[=]{if(!draft->loading)draft->revision=store->saveDraft({{"packet",draft->packet},{"answer",answer->toPlainText()},{"title",title->text()},{"lastSaved",draft->last},{"subject",subject->currentData().toString()},{"purpose",purpose->currentData().toString()},{"mode",mode->currentData().toString()},{"limit",limit->value()},{"from",from->text()},{"to",to->text()}},draft->revision)["draftRevision"].toString();};
  auto restore=[=]{const auto saved=store->draft();draft->loading=true;draft->packet=saved["packet"].toObject();draft->last=saved["lastSaved"].toString();draft->revision=saved["draftRevision"].toString();title->setText(saved["title"].toString());answer->setPlainText(saved["answer"].toString());for(auto p:QList<QPair<QComboBox*,QString>>{{subject,"subject"},{purpose,"purpose"},{mode,"mode"}}){int i=p.first->findData(saved[p.second].toString());if(i>=0)p.first->setCurrentIndex(i);}limit->setValue(saved["limit"].toInt(10));from->setText(saved["from"].toString());to->setText(saved["to"].toString());preview->setPlainText(draft->packet["markdown"].toString());draft->loading=false;};safe(restore);
  QObject::connect(reloadDraft,&QPushButton::clicked,page,[=]{safe([=]{restore();state->setText("已明确取最新共享草稿；其他入口新稿未被覆盖");});});
  QObject::connect(answer,&QPlainTextEdit::textChanged,page,[=]{safe(persist);});QObject::connect(title,&QLineEdit::textChanged,page,[=]{safe(persist);});
  for(auto c:{subject,purpose,mode})QObject::connect(c,&QComboBox::currentIndexChanged,page,[=]{safe(persist);});for(auto e:{from,to})QObject::connect(e,&QLineEdit::textChanged,page,[=]{safe(persist);});QObject::connect(limit,&QSpinBox::valueChanged,page,[=]{safe(persist);});
  QObject::connect(generate,&QPushButton::clicked,page,[=]{safe([=]{business::require(answer->toPlainText().trimmed().isEmpty(),"已有回填草稿；请先保存或明确新建分析，再换材料");const auto packet=sourceAnalysis::build(subject->currentData().toString(),business->read("collections"),{{"mode",mode->currentData().toString()},{"purpose",purpose->currentData().toString()},{"limit",limit->value()},{"from",from->text()},{"to",to->text()}});draft->packet=packet;draft->last.clear();preview->setPlainText(packet["markdown"].toString());persist();state->setText(QString("已冻结%1条完整来源材料；日期/目的变更后须重新生成。%2").arg(packet["itemCount"].toInt()).arg(packet["warnings"].toArray()[0].toString()));});});
  QObject::connect(copy,&QPushButton::clicked,page,[=]{safe([=]{business::require(!draft->packet.isEmpty(),"请先生成材料");QApplication::clipboard()->setText(draft->packet["markdown"].toString());state->setText("完整材料已复制；未上传、未调用AI");});});
  QObject::connect(exportPacket,&QPushButton::clicked,page,[=]{safe([=]{business::require(!draft->packet.isEmpty(),"请先生成材料");const auto path=QFileDialog::getSaveFileName(page,"导出完整本机材料","分析材料.md");if(path.isEmpty())return;const auto bytes=draft->packet["markdown"].toString().toUtf8();QSaveFile file(path);business::require(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"材料导出失败");state->setText("完整材料已导出："+path);});});
  QObject::connect(parse,&QPushButton::clicked,page,[=]{safe([=]{extracted->setPlainText(sourceAnalysis::extractResult(answer->toPlainText())["text"].toString());state->setText("只预览提取结果；原回答保留，尚未保存历史");});});
  QObject::connect(save,&QPushButton::clicked,page,[=]{safe([=]{business::require(store->draft()["draftRevision"].toString()==draft->revision,"其他入口已更新共享草稿；请重读后明确保存");const auto signature=sourceAnalysis::hash(draft->packet["markdown"].toString()+QChar(0)+title->text()+QChar(0)+answer->toPlainText());business::require(signature!=draft->last,"相同材料和回答已保存；历史未重复写入");const auto record=store->saveResult(draft->packet,title->text(),answer->toPlainText());draft->last=signature;persist();state->setText("已保存本机交接记录（手动回填，待核验）："+record["id"].toString());});});
  QObject::connect(fresh,&QPushButton::clicked,page,[=]{safe([=]{draft->loading=true;draft->packet={};draft->last.clear();answer->clear();title->clear();preview->clear();extracted->clear();draft->loading=false;persist();state->setText("已明确新建分析；已保存历史保留");});});
  return page;
}
