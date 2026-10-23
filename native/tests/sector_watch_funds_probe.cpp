#include "dark_stock.hpp"
#include <QCoreApplication>
#include <QFile>
#include <QDir>
#include <QJsonDocument>
#include <QDateTime>
#include <QTextStream>

// Explicit one-shot native diagnostic. No Store, production file, retry or credentials.
int main(int argc,char** argv){
 QCoreApplication app(argc,argv);QTextStream out(stdout);
 if(argc!=3){out<<"usage: probe raw-first-page new-output-directory\n";return 2;}
 QString folder=QString::fromLocal8Bit(argv[2]);if(QFile::exists(folder)||!QDir().mkpath(folder))return 2;
 QFile raw(QString::fromLocal8Bit(argv[1]));if(!raw.open(QIODevice::ReadOnly))return 2;
 auto first=QJsonDocument::fromJson(raw.readAll()).object();auto part=darkStock::normalize(first,"2026-10-12",1,"2026-10-12T13:45:43.266Z");
 QFile parsed(folder+"/first-page-normalized.json");if(!parsed.open(QIODevice::WriteOnly|QIODevice::NewOnly))return 2;parsed.write(QJsonDocument(part).toJson());parsed.close();
 out<<"OFFLINE_FIRST_PAGE rows="<<part["rows"].toArray().size()<<" total="<<part["coverage"].toObject()["totalReported"].toInt()<<"\n";out.flush();
 QJsonObject receipt{{"startedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"transport","Windows native Qt darkStock::fetch"},{"date","2026-10-12"},{"productionDatabaseTouched",false},{"retryCount",0}};
 try{auto s=darkStock::fetch("2026-10-12",{},[&](int page,int total){out<<"native-page="<<page<<" total="<<total<<"\n";out.flush();});QFile file(folder+"/full-snapshot.json");if(!file.open(QIODevice::WriteOnly|QIODevice::NewOnly))return 2;file.write(QJsonDocument(s).toJson());receipt["coverage"]=s["coverage"];receipt["status"]="complete";receipt["error"]="";out<<"NATIVE_COMPLETE rows="<<s["rows"].toArray().size()<<"\n";}catch(const std::exception& e){receipt["status"]="failed-no-complete-cache";receipt["error"]=QString::fromUtf8(e.what());out<<"NATIVE_FAILED "<<QString::fromUtf8(e.what())<<"\n";}
 receipt["fetchedAt"]=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);QFile log(folder+"/receipt.json");if(!log.open(QIODevice::WriteOnly|QIODevice::NewOnly))return 2;log.write(QJsonDocument(receipt).toJson());return 0;
}
