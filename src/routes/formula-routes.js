const express=require('express');
const controller=require('../controllers/formula-controller');
const router=express.Router();
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

router.post('/formulas',asyncRoute(controller.create));
router.post('/formulas/:uuid/deactivate',asyncRoute(controller.deactivate));
router.post('/formulas/:uuid/rollback',asyncRoute(controller.rollback));
router.get('/formulas',asyncRoute(controller.list));
router.get('/formulas/:uuid/history',asyncRoute(controller.history));
router.get('/formulas/:uuid/impact',asyncRoute(controller.impact));
router.post('/formulas/preview',asyncRoute(controller.runPreview));
router.post('/formulas/preview/bulk',asyncRoute(controller.runBulk));
module.exports=router;