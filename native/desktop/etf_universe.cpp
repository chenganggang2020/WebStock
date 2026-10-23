#include "etf_universe.hpp"
#include "securities_catalog_model.hpp"
#include <QHash>
#include <QJsonObject>
#include <stdexcept>
namespace etfUniverse {
QJsonArray merge(const QByteArray& source,const QJsonArray& previous){
 const auto directory=securitiesCatalog::fundFile(source)["items"].toArray();
 if(directory.size()>2000)throw std::runtime_error("ETF目录超过当前观察页容量，保留旧目录且未截断");
 QHash<QString,QJsonObject> prior;for(auto value:previous){auto row=value.toObject();const auto id=row["id"].toString();
  if(prior.contains(id))throw std::runtime_error("ETF既有目录身份重复");prior.insert(id,row);
 }
 QJsonArray out;for(auto value:directory){auto row=securitiesCatalog::instrument(value.toObject());
  auto old=prior.value(row["id"].toString());
  if(old["symbol"]==row["symbol"])for(auto key:{"quote","minute","minuteMeta"})if(old.contains(key))row[key]=old[key];
  row.remove("group");out.append(row);
 }
 return out;
}
}
