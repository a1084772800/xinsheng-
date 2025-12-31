
import { Story } from './types';

export const INITIAL_STORY: Story = {
    id: 'demo_story_mushroom',
    title: "勇敢的小蘑菇",
    topic: "友谊与勇气",
    goal: "interaction",
    voice: "Zephyr", // 适合童话风格
    style: "Clay", // 粘土风，更有童趣
    styleInstructions: "Stop-motion clay animation style, cute, vibrant colors, soft lighting, miniature world photography aesthetics.",
    date: new Date().toISOString().split('T')[0],
    status: "completed",
    cover: "https://images.unsplash.com/photo-1595418086054-9721663f2538?q=80&w=800&auto=format&fit=crop", // 使用一张真实的蘑菇图作为占位，或者保持随机种子
    tags: ["友谊", "助人为乐", "演示"],
    isOfflineReady: true, // 标记为就绪，以便在书架中直接显示（虽然音频可能需要实时生成/浏览器TTS）
    nodes: {
        'start': {
            id: 'start',
            type: 'linear',
            text: "在一片神奇的迷雾森林里，住着一个小蘑菇叫“咕噜”。咕噜个子小小的，但他有一顶红底白点的大帽子，就像一把漂亮的小花伞。",
            visual: "Close-up of a cute small mushroom character named Gulu with a big red cap with white dots. In a magical forest with soft moss and glowing plants. Claymation style.",
            layout: "Character centered at the bottom, looking up confidently.",
            imagePrompt: "Stop-motion clay animation style. Close-up of a cute small mushroom character named Gulu with a big red cap with white dots. Magical forest background, soft moss, glowing bokeh lights. Vertical 9:16 aspect ratio, masterpiece.",
            next: 'rain_starts'
        },
        'rain_starts': {
            id: 'rain_starts',
            type: 'choice',
            text: "突然，天空乌云密布，哗啦啦下起了大雨！这时，一只全身湿透的小蚂蚁跌跌撞撞地跑了过来，它冻得瑟瑟发抖。哎呀，咕噜该怎么做呢？",
            question: "如果是你，你会怎么帮助小蚂蚁呢？",
            visual: "Heavy rain falling in the forest. A tiny, wet, shivering ant standing next to the mushroom. The atmosphere is cold and blue.",
            layout: "Split composition: Mushroom on one side, shivering ant on the other.",
            imagePrompt: "Stop-motion clay animation style. Heavy rain scene in forest. A sad wet ant shivering near the red mushroom Gulu. Blue cold lighting tone. Vertical 9:16 aspect ratio.",
            options: [
                {
                    label: "躲进伞下",
                    text: "快来我的帽子下面躲雨吧！",
                    next: 'share_umbrella',
                    analysis: "选择分享与保护，体现了孩子的同理心和直接帮助他人的意愿。"
                },
                {
                    label: "找片树叶",
                    text: "我帮你找一件雨衣！",
                    next: 'find_leaf',
                    analysis: "选择寻找工具解决问题，体现了孩子的观察力与创造性思维。"
                }
            ]
        },
        'share_umbrella': {
            id: 'share_umbrella',
            type: 'linear',
            text: "咕噜挺起胸膛，大声说：“快进来！我的帽子大大的，一点雨都淋不到！”小蚂蚁钻进红帽子底下，顿时觉得暖洋洋的。",
            visual: "The mushroom stretching up to cover the ant. The ant looks happy and dry under the red cap. Warm lighting underneath.",
            layout: "Low angle shot looking up at the mushroom cap sheltering the ant.",
            imagePrompt: "Stop-motion clay animation style. The red mushroom Gulu sheltering the little ant under its cap. Warm yellow light glowing from under the cap, contrasting with blue rain outside. Vertical 9:16 aspect ratio.",
            next: 'ending'
        },
        'find_leaf': {
            id: 'find_leaf',
            type: 'linear',
            text: "咕噜灵机一动，弯腰捡起旁边一片巨大的四叶草，递给小蚂蚁：“给！这是一件超级雨衣！”小蚂蚁举着叶子，像举着一把绿色的小伞，高兴极了。",
            visual: "The mushroom handing a large green clover leaf to the ant. The ant holding the leaf like an umbrella.",
            layout: "Action shot of handing over the leaf.",
            imagePrompt: "Stop-motion clay animation style. The mushroom Gulu handing a large green clover leaf to the ant. The ant holding the leaf over its head. Cute interaction. Vertical 9:16 aspect ratio.",
            next: 'ending'
        },
        'ending': {
            id: 'ending',
            type: 'end',
            text: "过了一会儿，雨停了，天边挂起了一道彩虹。小蚂蚁感激地说：“谢谢你，勇敢的小蘑菇！”森林里的空气变得更甜了。",
            visual: "Sunlight breaking through clouds, a beautiful double rainbow. The mushroom and ant waving goodbye. Happy vibes.",
            layout: "Wide shot showing the forest clearing and the rainbow above.",
            imagePrompt: "Stop-motion clay animation style. Beautiful sunlight, double rainbow in the sky. The mushroom and ant standing together on moss, looking happy. Vibrant colors. Vertical 9:16 aspect ratio.",
        }
    }
};
