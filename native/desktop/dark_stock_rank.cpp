#include "dark_stock_rank.hpp"
#include <QRegularExpression>
#include <QVector>
#include <algorithm>
#include <stdexcept>
namespace darkStockRank {
namespace {
void need(bool ok,const char* text){if(!ok)throw std::invalid_argument(text);}
struct Entry {QJsonObject row;qint64 value;};
}
QJsonObject apply(const QJsonArray& rows,const QString& metric,const QString& direction){
 need(rows.size()<=6000,"Ranking input exceeds existing cache limit");
 need(metric=="amount"||metric=="visible"||metric=="combined","Unknown ranking metric");
 need(direction=="source"||direction=="inflow"||direction=="outflow","Unknown ranking direction");
 const QString field=metric=="amount"?"darkNetCents":metric=="visible"?"visibleNetCents":"combinedNetCents";
 static const QRegularExpression integer("^-?(0|[1-9][0-9]{0,17})$");
 int missing=0,zero=0,unreconciled=0;QVector<Entry> selected;selected.reserve(rows.size());
 for(const auto& value:rows){
  need(value.isObject(),"Ranking row is not an object");auto row=value.toObject();auto money=row.value(field);
  if(row.value("reconciled")!=true)++unreconciled;
  if(money.isNull()||money.isUndefined()){++missing;if(direction=="source")selected.append({row,0});continue;}
  need(money.isString()&&integer.match(money.toString()).hasMatch(),"Ranking amount is not integer cents");
  bool ok=false;auto n=money.toString().toLongLong(&ok);need(ok&&n>=-900719925474099100LL&&n<=900719925474099100LL,"Ranking amount exceeds source limit");
  if(n==0)++zero;
  if(direction=="source"||(direction=="inflow"&&n>0)||(direction=="outflow"&&n<0))selected.append({row,n});
 }
 if(direction!="source")std::stable_sort(selected.begin(),selected.end(),[&](const Entry& a,const Entry& b){return direction=="inflow"?a.value>b.value:a.value<b.value;});
 QJsonArray ranked;for(const auto& entry:selected)ranked.append(entry.row);
 return {{"rows",ranked},{"inputCount",rows.size()},{"rankedCount",ranked.size()},{"missingMetricCount",missing},{"zeroMetricCount",zero},{"unreconciledCount",unreconciled},{"metric",metric},{"direction",direction},{"paginationSnapshotConsistent",false}};
}
}
