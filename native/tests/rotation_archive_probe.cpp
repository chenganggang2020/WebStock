#include <QCoreApplication>
#include <QTextStream>
#include <QCryptographicHash>
#include <QFile>
#include "dark_rotation.hpp"
int main(int argc,char** argv){
  QCoreApplication app(argc,argv);auto args=app.arguments();if(args.size()<3)return 2;
  try{
    darkRotation::Store store(args[1]);QJsonArray files;
    for(int i=2;i<args.size();i++){
      QFile input(args[i]);if(!input.open(QIODevice::ReadOnly))return 3;
      QCryptographicHash before(QCryptographicHash::Sha256);before.addData(&input);input.seek(0);
      int count=store.importFile(args[i]);QCryptographicHash after(QCryptographicHash::Sha256);after.addData(&input);
      if(before.result()!=after.result())return 4;
      files.append(QJsonObject{{"path",args[i]},{"sha256",QString(before.result().toHex())},{"inserted",count},{"sourceUnchanged",true}});
    }
    QJsonArray summaries;for(auto date:store.dates())for(auto scope:QStringList{"industry","concept"})for(bool daily:{false,true}){
      auto rows=store.read(date,scope,daily);if(rows.isEmpty())continue;auto last=rows.last().toObject();
      auto code=last["rows"].toArray()[0].toObject()["code"].toString();
      summaries.append(QJsonObject{{"date",date},{"scope",scope},{"daily",daily},{"snapshots",rows.size()},{"boards",last["rows"].toArray().size()},{"receivedAt",last["receivedAt"]},{"exampleWindow5",daily?QJsonObject():darkRotation::window(rows,code,"combinedNetCents",5)}});
    }
    QTextStream(stdout)<<QJsonDocument(QJsonObject{{"files",files},{"summaries",summaries}}).toJson();return 0;
  }catch(const std::exception& e){QTextStream(stderr)<<e.what();return 1;}
}
