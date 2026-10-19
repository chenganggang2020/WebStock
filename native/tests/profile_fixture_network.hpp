#pragma once
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QJsonDocument>
#include <QTimer>
#include <QPointer>
#include <cstring>
class ProfileFixtureReply:public QNetworkReply {
 QByteArray payload;qint64 offset=0;bool ended=false;
public:
 ProfileFixtureReply(QNetworkRequest r,QByteArray p,int status,bool blocked,QObject*parent):QNetworkReply(parent),payload(std::move(p)){setRequest(r);setUrl(r.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,status);setHeader(QNetworkRequest::ContentLengthHeader,payload.size());setRawHeader("Content-Encoding","identity");open(QIODevice::ReadOnly);if(!blocked)QTimer::singleShot(0,this,[this]{release();});}
 void release(){if(ended)return;ended=true;setFinished(true);emit readyRead();emit finished();}
 void abort()override{if(ended)return;ended=true;setError(OperationCanceledError,"controlled cancellation");setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return payload.size()-offset+QNetworkReply::bytesAvailable();}
 qint64 readData(char*dst,qint64 max)override{auto n=qMin(max,qint64(payload.size()-offset));if(n<=0)return -1;std::memcpy(dst,payload.constData()+offset,size_t(n));offset+=n;return n;}
};
class ProfileFixtureNetwork:public QNetworkAccessManager {
public:
 QJsonObject responses;QString denied,blocked;QStringList urls;QList<QPointer<ProfileFixtureReply>> replies;
 explicit ProfileFixtureNetwork(QJsonObject data,QObject*parent=nullptr):QNetworkAccessManager(parent),responses(std::move(data)){}
 QNetworkReply* createRequest(Operation op,const QNetworkRequest&r,QIODevice*)override{if(op!=GetOperation)throw std::runtime_error("Unexpected transport operation");auto kind=r.url().path().split('/').value(2);urls.append(r.url().toString());auto raw=QJsonDocument(responses[kind].toObject()["body"].toObject()).toJson(QJsonDocument::Compact);auto reply=new ProfileFixtureReply(r,raw,kind==denied?403:200,kind==blocked,this);replies.append(reply);return reply;}
 void releaseAll(){for(auto reply:replies)if(reply)reply->release();}
};
