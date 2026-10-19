#include "scenario_tools_page.hpp"
#include <QApplication>
#include <QComboBox>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QPlainTextEdit>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QFile>
#include <QFontDatabase>
#include "scenario_tools.hpp"
#include <iostream>
void need(bool b,const char* m){if(!b)throw std::runtime_error(m);}
int main(int argc,char** argv){QApplication a(argc,argv);QTemporaryDir d;try{
 if(argc>2&&QString(argv[1])=="--preview"){int font=QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");if(font>=0)a.setFont(QFont(QFontDatabase::applicationFontFamilies(font).value(0),10));ScenarioToolsPage page(d.filePath("preview.json"));page.findChild<QComboBox*>("scenarioGroup")->setCurrentIndex(3);page.findChild<QComboBox*>("scenarioTool")->setCurrentIndex(2);page.findChild<QPushButton*>("scenarioCalculate")->click();page.resize(1024,768);page.show();a.processEvents();need(page.grab().save(argv[2]),"preview save");return 0;}
 ScenarioToolsPage p(d.filePath("draft.json"));
 auto group=p.findChild<QComboBox*>("scenarioGroup"),tool=p.findChild<QComboBox*>("scenarioTool");
 auto calc=p.findChild<QPushButton*>("scenarioCalculate");auto result=p.findChild<QPlainTextEdit*>("scenarioResult");
 need(group&&tool&&calc&&result,"controls missing");need(group->count()==4&&tool->count()==5,"categories");
 calc->click();need(result->toPlainText().isEmpty(),"missing cash calculated");need(p.findChild<QLabel*>("scenarioStatus")->text().contains("失败"),"missing error");
 p.findChild<QLineEdit*>("scenario_initialCapital")->setText("10000");p.findChild<QLineEdit*>("scenario_targetCapital")->setText("20000");calc->click();need(result->toPlainText().contains("期末资产（元）"),"localized result");
 p.findChild<QLineEdit*>("scenario_initialCapital")->setText("12000");need(result->toPlainText().isEmpty(),"stale result");
 p.findChild<QPushButton*>("scenarioSave")->click();ScenarioToolsPage reopened(d.filePath("draft.json"));need(reopened.findChild<QLineEdit*>("scenario_initialCapital")->text()=="12000","saved draft");need(reopened.findChild<QPlainTextEdit*>("scenarioResult")->toPlainText().isEmpty(),"restore auto calculated");
 tool->setCurrentIndex(1);calc->click();need(result->toPlainText().contains("修复月数"),"recovery calculate");tool->setCurrentIndex(0);need(p.findChild<QLineEdit*>("scenario_initialCapital")->text()=="12000","switch loses draft");
 group->setCurrentIndex(1);auto records=p.findChild<QTableWidget*>("scenario_positions");need(records&&records->rowCount()==0,"record empty");p.findChild<QPushButton*>("scenario_add_positions")->click();need(records->rowCount()==1,"add record");records->setItem(0,0,new QTableWidgetItem("SH:stock:600000"));records->setItem(0,2,new QTableWidgetItem("2000"));p.findChild<QLineEdit*>("scenario_cashBalance")->setText("1000");calc->click();need(result->toPlainText().contains("3000"),"records calculate");
 records->item(0,2)->setText("bad");calc->click();need(result->toPlainText().isEmpty(),"invalid record silently zero");
 auto saved=p.saveState();ScenarioToolsPage restored(d.filePath("other.json"));restored.restoreState(saved);need(restored.findChild<QTableWidget*>("scenario_positions")->item(0,2)->text()=="bad","raw invalid draft lost");
 p.findChild<QPushButton*>("scenarioClear")->click();need(records->rowCount()==0,"clear records");p.findChild<QPushButton*>("scenarioSave")->click();ScenarioToolsPage cleared(d.filePath("draft.json"));need(cleared.findChild<QTableWidget*>("scenario_positions")->rowCount()==0,"clear save");
 auto before=p.saveState();auto broken=before;auto brokenDrafts=before["drafts"].toObject();brokenDrafts["risk"]=QJsonObject{{"positions",true}};broken["drafts"]=brokenDrafts;p.restoreState(broken);need(p.saveState()==before,"malformed restore replaced input");
 QFile fixture(argc>1?argv[1]:"");need(fixture.open(QIODevice::ReadOnly),"fixture open");auto cases=QJsonDocument::fromJson(fixture.readAll()).object()["cases"].toArray();int toolsChecked=0;
 for(auto t:ScenarioToolsPage::contract()["tools"].toArray()){auto def=t.toObject();auto id=def["id"].toString();QJsonObject input;for(auto c:cases){auto cs=c.toObject();if(cs["name"]==id){input=cs["input"].toObject();break;}}need(!input.isEmpty(),"missing UI fixture");QJsonObject raw;for(auto f:def["fields"].toArray()){auto field=f.toObject();auto key=field["key"].toString();auto kind=field["kind"].toString();if(kind=="records"){QJsonArray rows;for(auto r:input[key].toArray()){QJsonObject cells;for(auto col:field["columns"].toArray()){auto k=col.toString();auto v=r.toObject()[k];cells[k]=v.isUndefined()||v.isNull()?QString():v.isString()?v.toString():QString::number(v.toDouble(),'g',15);}rows.append(cells);}raw[key]=rows;}else if(kind=="sequence"){QStringList xs;for(auto v:input[key].toArray())xs<<QString::number(v.toDouble(),'g',15);raw[key]=xs.join(",");}else raw[key]=QString::number(input[key].toDouble(),'g',15);}
  p.restoreState({{"schema","scenario-drafts/v1"},{"module",id},{"drafts",QJsonObject{{id,raw}}}});calc->click();need(p.findChild<QLabel*>("scenarioStatus")->text().startsWith("已按"),("UI calculate "+id).toStdString().c_str());need(!result->toPlainText().isEmpty(),"empty result");++toolsChecked;
 }
 group->setCurrentIndex(0);tool->setCurrentIndex(3);p.findChild<QLineEdit*>("scenario_cash")->setText("10000");p.findChild<QLineEdit*>("scenario_prices")->setText("10,,8");calc->click();need(result->toPlainText().isEmpty(),"empty sequence silently removed");
 int iid=0;for(int n=1;n<=8;n++)for(int k=1;k<=n+1;k++)for(double win:{0.,25.,50.,100.}){double expected=0;for(int bits=0;bits<(1<<n);bits++){int run=0;bool hit=false;double weight=1;for(int i=0;i<n;i++){bool loss=bits&(1<<i);run=loss?run+1:0;hit=hit||run>=k;weight*=loss?1-win/100:win/100;}if(hit)expected+=weight;}auto out=scenario::evaluate("lossRun",scenario::Object{{"winRatePercent",win},{"trialCount",n},{"streakLength",k}});auto r=std::get<scenario::Object>(std::get<scenario::Object>(out.data).at("result").data);double actual=std::get<double>(r.at("atLeastOneStreakProbabilityPercent").data);need(std::abs(actual-expected*100)<1e-6,"IID independent enumeration");++iid;}
 std::cout<<toolsChecked<<" tool forms calculated; "<<iid<<" IID exhaustive small cases GREEN\n";
 if(argc>2){group->setCurrentIndex(3);tool->setCurrentIndex(2);calc->click();p.resize(1024,768);p.show();a.processEvents();need(p.grab().save(argv[2]),"screenshot save");}
 std::cout<<"scenario page: categories, calculate, missing/invalid, stale, records, save/reopen/clear GREEN\n";
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}return 0;}
