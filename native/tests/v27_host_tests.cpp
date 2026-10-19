#include "window.hpp"
#include "business_store.hpp"
#include <QtWidgets>
#include <QtTest>
#include <iostream>

static void need(bool value,const char* message){if(!value)throw std::runtime_error(message);}
static void shot(QWidget& page,QString name){
  auto dir=qEnvironmentVariable("NATIVE_REVIEW_SHOTS");if(dir.isEmpty())return;
  QDir().mkpath(dir);QTest::qWait(80);need(page.grab().save(dir+"/"+name+".png"),"screenshot failed");
}
int main(int argc,char**argv){QApplication app(argc,argv);try{
  QTemporaryDir directory;auto store=std::make_shared<BusinessStore>(directory.filePath("business-v1.sqlite"));
  auto topic=store->save("topics",{{"name","设备研究 · 受控界面检查"}});
  auto doc=store->save("docs",{{"title","公司原文"},{"text","测试公司（600001，上交所）生产设备"}});
  store->save("relations",{{"topicId",topic["id"]},{"documentId",doc["id"]},{"stage","equipment"},{"claim","生产设备"},{"quote","生产设备"},{"verification","manuallyVerified"},{"polarity","supports"},{"product","检测设备"},
    {"company",QJsonObject{{"name","测试公司"},{"instrumentId","SH:stock:600001"},{"identityDocumentId",doc["id"]},{"identityQuote","测试公司（600001，上交所）"}}}});
  store->save("trades",{{"accountId","local"},{"instrumentId","SH:stock:600001"},{"name","测试公司"},{"date","2026-10-01"},{"side","buy"},{"quantity",100},{"price",10.},{"fee",5.},{"tax",0.}});
  store->save("reports",{{"title","受控原快照"},{"text","本机账本原记录"},{"accountId","local"},{"legacySource","portfolio_snapshots"},
    {"legacyOriginal",QJsonObject{{"snapshot_date","2026-10-01"},{"total_assets",3000.},{"cash_balance",1000.},{"total_market_value",2000.}}}});
  const auto before=store->backup();
  Window window(true,{},directory.path());window.resize(1600,1000);window.show();need(QTest::qWaitForWindowExposed(&window),"native window not exposed");
  for(const QString& mode:{QString("quotes"),QString("classic"),QString("focus")}){
    window.setLayoutMode(mode);window.findChild<QPushButton*>("workspace自选与账户")->click();
    auto tabs=window.findChild<QTabWidget*>("accountWorkspace");need(tabs&&tabs->count()==2,"account analysis host missing");tabs->setCurrentIndex(1);
    auto analysis=tabs->widget(1);need(analysis->isVisible()&&analysis->findChild<QTableWidget*>("analysisPositions")->rowCount()==1,"actual account structure not rendered");
    auto inner=analysis->findChild<QTabWidget*>();inner->setCurrentIndex(1);auto history=analysis->findChild<QTableWidget*>("analysisHistory");
    need(history->rowCount()==1,"account historical original missing");history->cellClicked(0,0);
    need(analysis->findChild<QPlainTextEdit*>("analysisOriginal")->toPlainText().contains("total_assets"),"history selection not original record");
    shot(window,"windows-account-host-"+mode);
    window.findChild<QPushButton*>("workspace主页")->click();need(!analysis->isVisible(),"account back not direct home");
  }
  window.findChild<QPushButton*>("workspace研究")->click();
  auto research=window.findChild<QTabWidget*>("researchWorkspace");need(research,"research workspace missing");research->setCurrentIndex(1);
  auto industry=research->findChild<QTabWidget*>("industryWorkspace");need(industry,"industry tabs missing");industry->setCurrentIndex(1);
  auto company=industry->findChild<QWidget*>("researchCompaniesPage");auto table=company->findChild<QTableWidget*>("researchCompanyTable");
  need(company->isVisible()&&table->rowCount()==1,"company host page missing rows");table->cellClicked(0,0);
  need(company->findChild<QPlainTextEdit*>("companyOriginal")->toPlainText().contains("测试公司（600001，上交所）"),"selected company not linked to original");
  auto product=company->findChild<QLineEdit*>("companyProduct");product->setText("保留的未保存产品");shot(window,"windows-research-company-list");
  auto graphTabs=company->findChild<QTabWidget*>();graphTabs->setCurrentIndex(1);shot(window,"windows-research-company-graph");
  window.resize(1100,720);QTest::qWait(100);need(company->height()>300&&product->text()=="保留的未保存产品","narrow host lost draft/space");shot(window,"windows-research-company-narrow");
  window.findChild<QPushButton*>("workspace主页")->click();window.findChild<QPushButton*>("workspace研究")->click();
  need(company->isVisible()&&product->text()=="保留的未保存产品","subpage switch lost company draft");
  const auto after=store->backup();for(auto key:{"accounts","trades","reports","relations","docs"})need(before[key]==after[key],"navigation or draft mutated persisted records");
  std::cout<<"PASS v27 actual Window account/research host, three layouts, exact historical original, narrow page and unsaved draft isolation\n";
}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}return 0;}
