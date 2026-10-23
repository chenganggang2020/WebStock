#include "account_edit_model.hpp"
#include <QRegularExpression>
#include <cmath>
#include <stdexcept>
namespace accountEdit {
namespace {void need(bool v,const char*m){if(!v)throw std::runtime_error(m);}void valid(QJsonObject a){need(a["id"].isString()&&!a["id"].toString().isEmpty()&&a["id"].toString().size()<=100,"账户完整ID无效");need(a["type"]=="ledger"||a["type"]=="paper","账户类型无效");}
double cash(QString s){s=s.trimmed();need(!s.isEmpty(),"请输入可用资金；0元请明确输入0");need(QRegularExpression("\\A[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?\\z").match(s).hasMatch(),"可用资金须为有效十进制金额");bool ok=false;double n=s.toDouble(&ok);need(ok&&std::isfinite(n),"金额须为有限且可保存的数值");need(n>=0,"可用资金不能小于0");n=std::floor(n*100+0.5)/100;need(std::isfinite(n),"金额超出可保存范围");return n;}}
void check(const QJsonObject& expected,const QJsonObject& current){valid(expected);valid(current);need(expected==current,"账户已变化；草稿保留，请重读后编辑");}
QJsonObject draft(const QJsonObject& a){valid(a);QJsonObject d;for(auto k:{"name","broker","maskedNumber","note"})d[k]=a[k].toString();d["editCash"]=false;d["cashText"]=a["cashBalance"].isDouble()?QString::number(a["cashBalance"].toDouble(),'g',16):QString();return d;}
QJsonObject propose(const QJsonObject& expected,const QJsonObject& d){valid(expected);need(d.size()==6&&d["editCash"].isBool(),"草稿字段无效");auto candidate=expected;for(auto k:{"name","broker","maskedNumber","note"}){need(d[k].isString(),"编辑内容须为文本");if(d[k]!=expected[k].toString())candidate[k]=d[k].toString().trimmed();}need(!candidate["name"].toString().trimmed().isEmpty(),"账户名称不能为空");need(d["cashText"].isString(),"现金输入须为文本");if(d["editCash"].toBool())candidate["cashBalance"]=cash(d["cashText"].toString());return {{"expected",expected},{"candidate",candidate},{"changed",candidate!=expected},{"cashEdited",d["editCash"]},{"warning",""},{"cashMeaning","手工现金余额快照；不是出入金流水，不生成交易"}};}
}
