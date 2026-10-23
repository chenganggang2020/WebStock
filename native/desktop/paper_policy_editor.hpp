#pragma once
#include <QtWidgets>
#include <functional>
#include "paper_policy_settings.hpp"
namespace paperPolicy {
class Editor:public QWidget {
public:
 struct Host{std::function<QJsonObject()> account;std::function<QString()> now;};
 Editor(Host host,QString settingsFile,QWidget*parent=nullptr);
private:
 Host host;Store store;QJsonObject shownAccount;double revision=-1;
 QComboBox*state;QLineEdit*percent;QCheckBox*confirmed;QLabel*message;QPushButton*save;
 void reload();void submit();
};
}
