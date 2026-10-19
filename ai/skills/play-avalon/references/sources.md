# 来源与适配记录
检索日期：2026-10-19。这里区分规则、社区经验、研究和原创设计；未宣称任何单一套路具有普遍最优胜率。

## 规则
- The Resistance: Avalon 原版规则书镜像：https://officialgamerules.org/wp-content/uploads/2025/04/resistance-avalon-rulebook.pdf
- 本项目用户提供的角色权限矩阵和已实现 5–10 人标准流程是集成基线，最终仍以经过校验的服务器配置为准。不能从扩展版、家规或未知平台偷加能力。

## 中文社区原作者攻略
- 阿瓦隆百科，梅林：https://hackmd.io/@AvalonPediaTW/SkgNO9FL3
  参考重点：传递有效选择同时隐藏信息来源。其十人派票区间和平台习惯不作为本项目默认算法。
- 阿瓦隆百科，红方基础原则：https://hackmd.io/@AvalonPediaTW/BkgHx2Lun
  参考重点：任务破坏与刺杀目标并行。按角色位阶协调的前提不符合本项目“只知阵营不知准确角色”，因此不直接移植。
- 阿瓦隆百科，奥伯伦：https://hackmd.io/@AvalonPediaTW/Hy2G1MdK3
  参考重点：在不知道同伴的情况下竞争，不能为了演好人忘记邪恶目标。平台术语、尾派与湖中规则未移植。
- 阿瓦隆百科，快速指南：https://hackmd.io/@AvalonPediaTW/HkkFxf8v3
  参考重点：关注行动和信息，不以固定投票口诀替代局势判断。
以上是经验性来源，不是规则书，也不证明策略优劣；未复制文章原文或赛事整局记录。

## 研究与真人对话
- Light et al., AvalonBench (2023)：https://arxiv.org/abs/2310.05036
  分角色提示与分阶段评估可作为工程参考，不能以旧模型论文成绩预测当前模型能力。
- Stepputtis et al., Long-Horizon Dialogue Understanding… (EMNLP 2023)：https://sstepput.github.io/Avalon-NLU/
- 作者数据仓库：https://github.com/sstepput/Avalon-NLU
  官网说明含 20 局、2384 条发言和说服/欺骗标签；六人配置是梅林、派西、莫甘娜、刺客、两忠臣，因此不直接覆盖莫德雷德与奥伯伦。项目页展示真实聊天样例，本次没有下载、清洗或训练整个语料。
  后续可按整局授权与隐私要求整理对话，剥离真值与未来信息，再做情境检索或评测；不要把数据文件的全知状态直接喂给玩家。
- Nakamura, Is it Percival time yet? (SIGBOVIK 2017)：https://www.homepages.ucl.ac.uk/~ucacyna/fun/avalonstats.pdf
  小样本探索，只用于提醒“公开身份可能有代价”，不用于宣称固定策略因果有效。

## 原创范围
本 skill 的运行时约束、八角色策略卡、情境对话、接入契约和验收案例为本项目的原创综合设计。社区资料只提供有限启发。dialogues.md 的话术不是以上真人资料的逐字转写，不作训练效果证据。尚未在用户本地项目中接入，也未测出真实胜率增益。
