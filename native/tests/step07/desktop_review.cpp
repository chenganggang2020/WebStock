#include "window.hpp"
#include "global_market_page.hpp"
#include "../step05/fixtures.hpp"
#include <QtWidgets>
int main(int argc,char** argv){
 QApplication app(argc,argv);app.setOrganizationName("StockStep07Isolated");app.setApplicationName("StockStep07Isolated");app.setFont(QFont("Microsoft YaHei UI",10));
 const QString root=QStringLiteral(STEP07_ROOT);const auto out=root+"/output/step07-delivery-review";QDir().mkpath(out+"/session");
 qputenv("D05_PAINT_SEEDS",(root+"/output/native-r01-r07-20261019/parallel/window3-data/d05-font-baseline-10/seeds").toUtf8());
 const auto data=out+"/session/global-market-native-v1.json";
 if(!QFile::exists(data)){auto day=fixture::make("daily64"),minute=fixture::make("minute30000");auto state=day.state;auto series=state["series"].toObject();series[minute.key+":intraday"]=minute.series;state["series"]=series;fixture::write(data,QJsonDocument(state).toJson());}
 Window window(true,out+"/session/review.ini",out+"/session");window.setWindowTitle("Stock Step07 ISOLATED REVIEW");window.resize(1280,900);window.show();
 QObject::connect(&app,&QCoreApplication::aboutToQuit,[&]{fixture::write(out+"/normal-exit.json",QJsonDocument(QJsonObject{{"normalExit",true},{"dataDirectory",out+"/session"}}).toJson());});
 return app.exec();
}
