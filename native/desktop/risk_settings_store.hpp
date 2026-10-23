#pragma once
#include "risk_settings_model.hpp"
#include <QSaveFile>
#include <QFile>
#include <QLockFile>
class RiskSettingsStore {
 QString path;
public:
 explicit RiskSettingsStore(QString file):path(QFileInfo(file).absoluteFilePath()){riskSettings::need(QDir().mkpath(QFileInfo(path).absolutePath()),"设置目录不可用");read();}
 QString filePath()const{return path;}
 QJsonObject read()const{QFile f(path);if(!f.exists())return riskSettings::empty();riskSettings::need(f.open(QIODevice::ReadOnly)&&f.size()<=1024*1024,"风险设置不可读或超过1MiB，未重建");QJsonParseError e;auto d=QJsonDocument::fromJson(f.readAll(),&e);riskSettings::need(e.error==QJsonParseError::NoError&&d.isObject(),"风险设置损坏，未清空");return riskSettings::validateRecord(d.object());}
 QJsonObject save(const QJsonObject& thresholds,const QJsonObject& expected,QJsonValue original=QJsonValue(QJsonValue::Undefined),QJsonArray warnings={})const{riskSettings::validateThresholds(thresholds);QLockFile lock(path+".lock");lock.setStaleLockTime(30000);riskSettings::need(lock.tryLock(1000),"风险设置正在保存，请保留草稿重试");auto current=read();riskSettings::need(riskSettings::canonical(current)==riskSettings::canonical(expected),"设置已被其他页面修改，草稿未覆盖，请显式重读");riskSettings::need(current.value("revision").toDouble()<9007199254740991.,"设置版本已达上限");auto next=current;next["thresholds"]=thresholds;next["revision"]=current.value("revision").toDouble()+1;next["updatedAt"]=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);if(!original.isUndefined()){next["legacyOriginal"]=original;next["importWarnings"]=warnings;}riskSettings::validateRecord(next);auto bytes=riskSettings::json(next);QSaveFile f(path);riskSettings::need(f.open(QIODevice::WriteOnly)&&f.write(bytes)==bytes.size()&&f.commit(),"风险设置保存失败，原设置未覆盖");return next;}
};
