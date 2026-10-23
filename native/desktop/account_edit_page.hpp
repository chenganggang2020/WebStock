#pragma once
#include <QWidget>
#include <QJsonArray>
#include <QJsonObject>
#include <functional>
class QComboBox;class QLineEdit;class QTextEdit;class QCheckBox;class QLabel;class QPushButton;
struct AccountEditHost {std::function<QJsonArray()> loadAccounts;std::function<QJsonObject(QJsonObject,QJsonObject)> compareAndSave;bool atomicCas=false;};
class AccountEditPage final:public QWidget{
 public:explicit AccountEditPage(AccountEditHost host,QWidget*parent=nullptr);void reload();void cancel();void preview();void commit();void setActive(bool);QJsonObject currentDraft()const;QJsonObject saveState()const;void restoreState(QJsonObject);bool back();
 private:AccountEditHost host;QJsonArray accounts;QJsonObject expected,proposal;QComboBox* choice;QLineEdit *name,*broker,*masked,*cash;QTextEdit*note;QCheckBox*editCash;QLabel*message;QPushButton*save;bool loading=false,active=true;void select();void changed();
};
