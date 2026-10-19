#include "paper_automation_store.hpp"
#include "paper_monitor_model.hpp"
#include <QtSql>
namespace paperAutomation {
namespace {
void need(bool ok,const QString&why){if(!ok)throw std::runtime_error(why.toUtf8().constData());}
struct Connection {
 QString name=QUuid::createUuid().toString(QUuid::WithoutBraces);QSqlDatabase db;
 Connection(QString path,bool write){db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);db.setConnectOptions(write?"QSQLITE_BUSY_TIMEOUT=5000":"QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=5000");if(!db.open()){auto error=db.lastError().text();db=QSqlDatabase();QSqlDatabase::removeDatabase(name);throw std::runtime_error(error.toStdString());}}
 ~Connection(){db.close();db=QSqlDatabase();QSqlDatabase::removeDatabase(name);}
};
void sql(QSqlDatabase db,QString text){QSqlQuery q(db);need(q.exec(text),q.lastError().text());}
QString definition(QString text){return text.toLower().remove(QRegularExpression("\\s+"));}
void columns(QSqlDatabase db){QSqlQuery q(db);need(q.exec("PRAGMA table_xinfo(paper_execution_books)"),"纸面执行库列不可读");QStringList names{"account_id","revision","payload","sha256"};int at=0;while(q.next()){need(at<names.size()&&q.value(0).toInt()==at&&q.value(1).toString()==names[at]&&q.value(2).toString().toUpper()==(at==1?"INTEGER":"TEXT")&&q.value(3).toInt()==(at>0?1:0)&&q.value(4).isNull()&&q.value(5).toInt()==(at==0?1:0)&&q.value(6).toInt()==0,"纸面执行库列定义不符，未猜测或重建");++at;}need(at==names.size(),"纸面执行库列缺失");}
void schema(QSqlDatabase db,bool create){
 QSqlQuery q(db);need(q.exec("PRAGMA application_id")&&q.next(),"纸面库身份不可读");int app=q.value(0).toInt();need(q.exec("PRAGMA user_version")&&q.next(),"纸面库版本不可读");int version=q.value(0).toInt();
 need(q.exec("SELECT type,name,tbl_name,sql FROM sqlite_master"),"纸面库结构不可读");bool book=false,index=false;
 while(q.next()){auto type=q.value(0).toString(),name=q.value(1).toString(),table=q.value(2).toString();if(type=="index"&&name=="sqlite_autoindex_paper_execution_books_1"&&table=="paper_execution_books"&&q.value(3).isNull()){need(!index,"纸面库主键索引重复");index=true;continue;}
  need(type=="table"&&name=="paper_execution_books"&&table==name,"纸面执行库有未知表、视图、触发器或索引，未修改外库");need(definition(q.value(3).toString())=="createtablepaper_execution_books(account_idtextprimarykey,revisionintegernotnull,payloadtextnotnull,sha256textnotnull)","纸面执行库表定义不是已审阅结构，未重建");columns(db);book=true;
 }
 if(create&&!book&&!index&&app==0&&version==0){sql(db,"CREATE TABLE paper_execution_books(account_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL)");sql(db,"PRAGMA application_id=1465077813");sql(db,"PRAGMA user_version=1");schema(db,false);return;}
 need(app==1465077813&&version==1&&book&&index,"不是本机F05纸面执行库或版本，未修改其他库");
 need(q.exec("PRAGMA index_list(paper_execution_books)")&&q.next()&&q.value(1).toString()=="sqlite_autoindex_paper_execution_books_1"&&q.value(2).toInt()==1&&q.value(3).toString()=="pk"&&q.value(4).toInt()==0&&!q.next(),"纸面执行库主键索引结构异常");
 need(q.exec("PRAGMA index_xinfo(sqlite_autoindex_paper_execution_books_1)"),"纸面执行库主键列不可读");int n=0;while(q.next()){need(n<2&&q.value(0).toInt()==n&&q.value(1).toInt()==(n==0?0:-1)&&(n==0?q.value(2).toString()=="account_id":q.value(2).isNull())&&q.value(3).toInt()==0&&q.value(4).toString()=="BINARY"&&q.value(5).toInt()==(n==0?1:0),"纸面执行库主键列或排序异常");++n;}need(n==2,"纸面执行库主键列缺失");
}
QJsonObject load(QSqlDatabase db,const QString&id){QSqlQuery q(db);q.prepare("SELECT revision,payload,sha256 FROM paper_execution_books WHERE account_id=?");q.addBindValue(id);need(q.exec(),q.lastError().text());if(!q.next())return {};auto raw=q.value(1).toByteArray();need(raw.size()<=Store::Limit,"纸面执行账本超过16MiB，未截断");QJsonParseError e;auto doc=QJsonDocument::fromJson(raw,&e);need(e.error==QJsonParseError::NoError&&doc.isObject(),"纸面执行账本损坏");auto b=doc.object();need(b["schema"]=="native-paper-automation-book/v1"&&b["accountId"]==id&&b["revision"].toDouble(-1)==q.value(0).toLongLong()&&paperMonitor::hash(b)==q.value(2).toString(),"纸面执行账本身份或指纹不符");return b;}
}
QJsonObject Store::read(const QString&id)const{if(!QFileInfo::exists(file))return {};Connection c(file,false);schema(c.db,false);return load(c.db,id);}
QJsonObject Store::transact(const QString&id,qint64 expected,const std::function<QJsonObject(QJsonObject)>&change,const std::function<bool()>&canCommit)const{
 need(!id.isEmpty()&&id.size()<=200&&expected>=-1&&expected<9007199254740990LL,"纸面账本身份或版本无效");need(QDir().mkpath(QFileInfo(file).absolutePath()),"纸面库目录不可写");Connection c(file,true);sql(c.db,"PRAGMA synchronous=FULL");sql(c.db,"BEGIN IMMEDIATE");try{schema(c.db,true);auto before=load(c.db,id);qint64 revision=before.isEmpty()?-1:qint64(before["revision"].toDouble());need(revision==expected,"纸面执行账本已变化，请重新读取");auto next=change(before);need(!next.isEmpty()&&next["schema"]=="native-paper-automation-book/v1"&&next["accountId"]==id,"事务返回其他账户或无效状态");if(!before.isEmpty())need(next["openingHash"]==before["openingHash"]&&next["openingInput"]==before["openingInput"],"事务不能覆盖起始材料");if(next==before){sql(c.db,"ROLLBACK");return before;}next["revision"]=double(revision+1);auto raw=QJsonDocument(next).toJson(QJsonDocument::Compact);need(raw.size()<=Limit,"纸面执行账本超过16MiB，未截断");QSqlQuery q(c.db);q.prepare("INSERT INTO paper_execution_books(account_id,revision,payload,sha256) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,sha256=excluded.sha256");q.addBindValue(id);q.addBindValue(revision+1);q.addBindValue(QString::fromUtf8(raw));q.addBindValue(paperMonitor::hash(next));need(q.exec(),q.lastError().text());need(!canCommit||canCommit(),"纸面事务已取消，未写入任何结果");sql(c.db,"COMMIT");return next;}catch(...){sql(c.db,"ROLLBACK");throw;}
}
}
