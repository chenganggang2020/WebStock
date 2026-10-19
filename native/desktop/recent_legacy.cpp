#include "recent_legacy.hpp"
#include <QDateTime>
#include <QFileInfo>
#include <QJsonObject>
#include <QRegularExpression>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTimeZone>
#include <QUuid>
#include <cmath>
#include <stdexcept>
namespace {
void require(bool ok,const char* message) {if(!ok)throw std::runtime_error(message);}
struct ReadConnection {
  QString name=QUuid::createUuid().toString();
  QSqlDatabase db=QSqlDatabase::addDatabase("QSQLITE",name);
  ~ReadConnection(){db.close();db={};QSqlDatabase::removeDatabase(name);}
};
}
QJsonArray recentLegacy::read(const QString& path) {
  require(QFileInfo(path).isFile(),"旧数据库不存在，未创建文件");
  ReadConnection c;c.db.setDatabaseName(path);
  c.db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=100");
  require(c.db.open(),"旧数据库只读打开失败");
  require(c.db.tables().contains("recent_stocks"),"没有旧最近查看表");
  QSqlQuery q(c.db);
  require(q.exec("SELECT code,name,last_viewed_at,view_count,last_price,last_change FROM recent_stocks ORDER BY last_viewed_at DESC,code LIMIT 10001"),"旧最近查看字段不兼容");
  QJsonArray result;
  while(q.next()) {
    require(result.size()<10000,"旧最近查看超过10000条，请先分批整理");
    const auto code=q.value(0).toString(),name=q.value(1).toString().trimmed();
    require(QRegularExpression("^[0-9]{6}$").match(code).hasMatch() && !name.isEmpty() && name.size()<=128,"旧证券代码或名称无效");
    const auto raw=q.value(2).toString();
    QDateTime time;
    if(QRegularExpression("(Z|[+-][0-9]{2}:[0-9]{2})$").match(raw).hasMatch())time=QDateTime::fromString(raw,Qt::ISODate);
    else {
      const auto local=QDateTime::fromString(raw,"yyyy-MM-dd HH:mm:ss");
      if(local.isValid())time=QDateTime(local.date(),local.time(),QTimeZone::fromSecondsAheadOfUtc(28800));
    }
    bool ok=false;const auto count=q.value(3).toLongLong(&ok);
    require(time.isValid() && ok && count>=1 && count<=2147483647,"旧查看时间或次数无效，整批未导入");
    const QString market=code.startsWith("92")||code.startsWith('4')||code.startsWith('8')?"BJ":code.startsWith('5')||code.startsWith('6')||code.startsWith('9')?"SH":"SZ";
    const QString type=QStringList{"51","50","15","16","58","56"}.contains(code.left(2))?"etf":"stock";
    const bool knownFamily=type=="etf"||QRegularExpression("^(600|601|603|605|688|689|900|001|002|003|200|300|301|43|83|87|88|92)").match(code).hasMatch();
    const bool uncertain=!knownFamily||code.startsWith("000")||code.startsWith("399")||code.startsWith("899")||name.contains("指数")||name.contains("上证")||name.contains("北证");
    const QString guessedId=market+":"+type+":"+code;
    QJsonObject quote{{"cached",true},{"source","旧最近查看留存（非实时）"}};
    for(int i=4;i<=5;++i) {
      bool numeric=false;const auto n=q.value(i).toDouble(&numeric);
      quote[i==4?"price":"changePercent"]=!q.value(i).isNull()&&numeric&&std::isfinite(n)&&(i!=4||n>0)?QJsonValue(n):QJsonValue(QJsonValue::Null);
    }
    result.append(QJsonObject{{"id",uncertain?"legacy:ambiguous:"+code:guessedId},{"guessedId",guessedId},{"code",code},{"name",name},
      {"symbol",uncertain?QString():market.toLower()+code},{"lastViewedAt",time.toUTC().toString(Qt::ISODateWithMs)},
      {"createdAt",time.toUTC().toString(Qt::ISODateWithMs)},{"viewCount",count},{"quote",quote},
      {"origin","legacy-recent-stock-inferred"},{"canOpen",!uncertain},
      {"identityNote",uncertain?"旧记录未带市场/类型，身份有歧义；请从明确证券入口重新查看后再跳转":"旧股票代码推导身份，未推断为指数"}});
  }
  return result;
}
