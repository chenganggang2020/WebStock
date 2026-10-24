#include "quant_plugin_center.hpp"
#include <QApplication>
#include <QCommandLineParser>
#include <QStandardPaths>
#include <QTextStream>
#include <QDir>
#include <QJsonDocument>

int main(int argc,char** argv){
    QApplication app(argc,argv);app.setApplicationName("WebStock Plugin Host");app.setOrganizationName("WebStock");
    QCommandLineParser parser;parser.addHelpOption();
    parser.addOption({"root","插件及任务目录","path"});parser.addOption({"install","安装插件包并退出","file"});
    parser.addOption({"runtime","安装时指定Python解释器","file"});parser.addOption({"run","运行已安装功能 pluginId/operationId","operation"});
    parser.addOption({"input","运行使用的历史K线、多证券或已知事件CSV","file"});parser.addOption({"timeout","最长秒数","seconds","600"});
    parser.addOption({"parameters","参数JSON文件；未提供时使用插件默认值","file"});
    parser.addOption({"screenshot","在独立宿主中渲染当前页截图并退出（不运行任务）","file"});parser.process(app);
    auto root=parser.value("root");if(root.isEmpty())root=QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation)+"/plugins";
    try{
        quantPlugin::Repository repo(root);
        if(parser.isSet("install")){auto p=repo.install(quantPlugin::read(parser.value("install")));if(parser.isSet("runtime"))repo.configure(p.value("id").toString(),parser.value("runtime"),true);QTextStream(stdout)<<p.value("id").toString()<<"\n";return 0;}
        if(parser.isSet("run")){
            auto parts=parser.value("run").split('/');quantPlugin::require(parts.size()==2,"格式需要 pluginId/operationId");
            quantPlugin::Job job(root);job.changed=[&]{if(!job.active()){auto r=job.current();QTextStream(stdout)<<QJsonDocument(r).toJson(QJsonDocument::Compact)<<"\n";app.exit(r.value("status")=="completed"?0:1);}};
            auto parameters=parser.isSet("parameters")?quantPlugin::object(quantPlugin::read(parser.value("parameters"))):QJsonObject{};
            job.start(parts[0],parts[1],parser.value("input"),parameters,{{"closedBarsOnly",true},{"knownEventsOnly",true},{"knownValuationsOnly",true},{"knownObservationsOnly",true},{"knownQuotesOnly",true},{"adjustment","unknown"},{"timezone","unspecified"},{"volumeUnit","unspecified"},{"source","explicit local CLI input"}},parser.value("timeout").toInt());return app.exec();
        }
        QuantPluginCenter widget(root);widget.setWindowTitle("WebStock 插件中心 · 独立验收宿主");widget.resize(1320,850);widget.show();
        if(parser.isSet("screenshot"))QTimer::singleShot(500,&app,[&]{widget.grab().save(parser.value("screenshot"));app.quit();});
        return app.exec();
    }catch(const std::exception& e){QTextStream(stderr)<<e.what()<<"\n";return 2;}
}
